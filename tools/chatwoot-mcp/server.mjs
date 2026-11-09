#!/usr/bin/env node
// Minimal MCP server for a Chatwoot instance. stdio by default; MCP_TRANSPORT=http serves it remotely.
// Config via environment: CHATWOOT_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID,
// and optionally CHATWOOT_ALLOW_SEND=true to expose the customer-facing reply tool.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const { CHATWOOT_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID, CHATWOOT_ALLOW_SEND } = process.env;

if (!CHATWOOT_URL || !CHATWOOT_API_TOKEN || !CHATWOOT_ACCOUNT_ID) {
  console.error('Missing CHATWOOT_URL, CHATWOOT_API_TOKEN or CHATWOOT_ACCOUNT_ID');
  process.exit(1);
}

const BASE = `${CHATWOOT_URL.replace(/\/+$/, '')}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}`;
const ALLOW_SEND = CHATWOOT_ALLOW_SEND === 'true';
const MESSAGE_TYPES = ['incoming', 'outgoing', 'activity', 'template'];

async function api(path, { method = 'GET', query, body } = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, {
    method,
    headers: { api_access_token: CHATWOOT_API_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Chatwoot ${method} ${url.pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] });
const ts = s => (s ? new Date(s * 1000).toISOString() : null);

// The list/show endpoints use meta.sender + inbox_id; the search endpoint uses contact + inbox.
const conversationSummary = c => {
  const contact = c.meta?.sender || c.contact;
  return {
    id: c.id,
    status: c.status,
    inbox_id: c.inbox_id ?? c.inbox?.id,
    contact: contact && {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone_number,
    },
    assignee: c.meta?.assignee?.name || null,
    team: c.meta?.team?.name || null,
    priority: c.priority ?? null,
    labels: c.labels,
    unread_count: c.unread_count,
    last_activity_at: ts(c.last_activity_at),
    last_message: c.messages?.at(-1)?.content?.slice(0, 200) || null,
  };
};

const messageSummary = m => ({
  id: m.id,
  type: MESSAGE_TYPES[m.message_type] ?? m.message_type,
  private: m.private,
  sender: m.sender?.name || null,
  created_at: ts(m.created_at),
  content: m.content,
  attachments: (m.attachments || []).map(a => ({ type: a.file_type, url: a.data_url })),
});

function buildServer() {
  const server = new McpServer({ name: 'chatwoot', version: '0.4.0' });

  server.registerTool(
    'chatwoot_list_inboxes',
    {
      description: 'List the inboxes (channels) of the Chatwoot account.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const { payload } = await api('/inboxes');
        return ok(payload.map(i => ({ id: i.id, name: i.name, channel: i.channel_type })));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_list_conversations',
    {
      description:
        'List conversations (25 per page), most recent activity first. Use q to search message text; ' +
        'a search spans all statuses and ignores the status filter.',
      inputSchema: {
        status: z
          .enum(['open', 'resolved', 'pending', 'snoozed', 'all'])
          .optional()
          .describe('Default: open. Ignored when q is set'),
        assignee_type: z.enum(['me', 'unassigned', 'all', 'assigned']).optional().describe('Default: all'),
        inbox_id: z.number().int().optional(),
        labels: z.array(z.string()).optional(),
        q: z.string().optional().describe('Search text inside messages'),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, assignee_type, inbox_id, labels, q, page }) => {
      try {
        const query = { status, assignee_type: assignee_type || 'all', inbox_id, q, page };
        const path = q ? '/conversations/search' : '/conversations';
        const url = labels?.length ? `${path}?${labels.map(l => `labels[]=${encodeURIComponent(l)}`).join('&')}` : path;
        const res = await api(url, { query });
        const data = res.data || res;
        return ok({ counts: data.meta, conversations: data.payload.map(conversationSummary) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_get_conversation',
    {
      description:
        'Get a conversation with its messages (latest 20 by default). Pass before_message_id to page back through older messages.',
      inputSchema: {
        conversation_id: z.number().int(),
        before_message_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ conversation_id, before_message_id }) => {
      try {
        const [conversation, messages] = await Promise.all([
          api(`/conversations/${conversation_id}`),
          api(`/conversations/${conversation_id}/messages`, { query: { before: before_message_id } }),
        ]);
        return ok({
          conversation: conversationSummary(conversation),
          messages: messages.payload.map(messageSummary),
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_add_private_note',
    {
      description: 'Add an internal private note to a conversation. Only agents see it; the customer is NOT notified.',
      inputSchema: { conversation_id: z.number().int(), content: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ conversation_id, content }) => {
      try {
        const m = await api(`/conversations/${conversation_id}/messages`, {
          method: 'POST',
          body: { content, message_type: 'outgoing', private: true },
        });
        return ok({ created: messageSummary(m) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_list_agents',
    {
      description: 'List the agents of the account (use their id to assign conversations).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const agents = await api('/agents');
        return ok(
          agents.map(a => ({
            id: a.id,
            name: a.name,
            email: a.email,
            role: a.role,
            availability: a.availability_status,
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_list_teams',
    {
      description: 'List the teams of the account (use their id to assign conversations).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const teams = await api('/teams');
        return ok(teams.map(t => ({ id: t.id, name: t.name })));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_set_status',
    {
      description:
        'Change a conversation status: resolve it, mark it pending, snooze it or reopen it. ' +
        'The customer is not messaged, although the inbox may send its own automatic replies (e.g. CSAT on resolve).',
      inputSchema: {
        conversation_id: z.number().int(),
        status: z.enum(['open', 'resolved', 'pending', 'snoozed']),
        snoozed_until: z
          .string()
          .optional()
          .describe(
            'ISO 8601 date-time, only for snoozed. If omitted, it snoozes until the next customer reply, ' +
              'but a conversation already snoozed with a date keeps that date'
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ conversation_id, status, snoozed_until }) => {
      try {
        const body = { status };
        if (status === 'snoozed' && snoozed_until) {
          const t = Date.parse(snoozed_until);
          if (Number.isNaN(t)) throw new Error(`Invalid snoozed_until: ${snoozed_until}`);
          body.snoozed_until = Math.floor(t / 1000);
        }
        const r = await api(`/conversations/${conversation_id}/toggle_status`, { method: 'POST', body });
        return ok(r.payload || r);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_assign',
    {
      description:
        'Assign a conversation to an agent and/or a team. Pass null to unassign. Get ids from chatwoot_list_agents / chatwoot_list_teams.',
      inputSchema: {
        conversation_id: z.number().int(),
        assignee_id: z.number().int().nullable().optional().describe('Agent id, or null to remove the agent'),
        team_id: z.number().int().nullable().optional().describe('Team id, or null to remove the team'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ conversation_id, assignee_id, team_id }) => {
      try {
        if (assignee_id === undefined && team_id === undefined) throw new Error('Pass assignee_id and/or team_id');
        const path = `/conversations/${conversation_id}/assignments`;
        const result = {};
        // Chatwoot assigns either an agent or a team per request. Team goes first: changing the team can clear
        // or auto-pick the agent, and an explicit agent should win.
        if (team_id !== undefined) result.team = await api(path, { method: 'POST', body: { team_id } });
        if (assignee_id !== undefined) result.assignee = await api(path, { method: 'POST', body: { assignee_id } });
        return ok({
          team: result.team === undefined ? undefined : result.team?.name || null,
          assignee: result.assignee === undefined ? undefined : result.assignee?.name || null,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_set_labels',
    {
      description:
        'Replace the labels of a conversation with the given list (pass the current ones too to keep them; [] removes all).',
      inputSchema: { conversation_id: z.number().int(), labels: z.array(z.string()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ conversation_id, labels }) => {
      try {
        const r = await api(`/conversations/${conversation_id}/labels`, { method: 'POST', body: { labels } });
        return ok({ labels: r.payload });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_set_priority',
    {
      description: 'Set the priority of a conversation, or null to clear it.',
      inputSchema: {
        conversation_id: z.number().int(),
        priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ conversation_id, priority }) => {
      try {
        await api(`/conversations/${conversation_id}/toggle_priority`, { method: 'POST', body: { priority } });
        return ok({ priority });
      } catch (e) {
        return fail(e);
      }
    }
  );

  const contactSummary = c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone_number });

  server.registerTool(
    'chatwoot_search_contacts',
    {
      description:
        'Search contacts by name, email, phone or identifier. Use it before creating a contact to avoid duplicates.',
      inputSchema: { q: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ q }) => {
      try {
        const { payload } = await api('/contacts/search', { query: { q } });
        return ok(payload.map(contactSummary));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_create_contact',
    {
      description:
        'Create a contact. Search first to avoid duplicates. For email inboxes the contact needs an email; for WhatsApp, a phone in E.164 (+5491112345678).',
      inputSchema: {
        name: z.string().min(1),
        email: z.string().email().optional(),
        phone_number: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, email, phone_number }) => {
      try {
        const { payload } = await api('/contacts', { method: 'POST', body: { name, email, phone_number } });
        return ok(contactSummary(payload.contact));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'chatwoot_create_conversation',
    {
      description:
        'Open a new conversation for an existing contact in an inbox, without writing to the customer. ' +
        'Optionally record the message the customer sent (e.g. an email received elsewhere) as an incoming message: ' +
        'it is stored as written by the contact and is NOT sent, though inbox automations or bots may react to it. ' +
        'To write to the customer afterwards use chatwoot_send_reply.',
      inputSchema: {
        inbox_id: z.number().int(),
        contact_id: z.number().int(),
        incoming_message: z
          .string()
          .optional()
          .describe('Text the customer sent, recorded as incoming. Include the original date in the text if relevant'),
        status: z.enum(['open', 'pending', 'resolved']).optional().describe('Default: open'),
        assignee_id: z.number().int().optional(),
        team_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ inbox_id, contact_id, incoming_message, status, assignee_id, team_id }) => {
      try {
        const c = await api('/conversations', {
          method: 'POST',
          body: { inbox_id, contact_id, status, assignee_id, team_id },
        });
        const result = { conversation: conversationSummary(c) };
        if (incoming_message) {
          const m = await api(`/conversations/${c.id}/messages`, {
            method: 'POST',
            body: { content: incoming_message, message_type: 'incoming', private: false },
          });
          result.recorded_message = messageSummary(m);
        }
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    }
  );

  if (ALLOW_SEND) {
    server.registerTool(
      'chatwoot_send_reply',
      {
        description:
          'SEND a reply to the customer on their channel (email, WhatsApp, etc.). This cannot be undone. ' +
          'Before calling, show the user the exact text and get their explicit approval in this conversation.',
        inputSchema: { conversation_id: z.number().int(), content: z.string().min(1) },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      async ({ conversation_id, content }) => {
        try {
          const m = await api(`/conversations/${conversation_id}/messages`, {
            method: 'POST',
            body: { content, message_type: 'outgoing', private: false },
          });
          return ok({ sent: messageSummary(m) });
        } catch (e) {
          return fail(e);
        }
      }
    );
  }
  return server;
}

const { MCP_TRANSPORT, MCP_SECRET, PORT = '3000' } = process.env;

if (MCP_TRANSPORT === 'http') {
  // Remote mode for Claude Code (Bearer header) and ChatGPT (secret URL), stateless Streamable HTTP.
  if (!MCP_SECRET || MCP_SECRET.length < 32) {
    console.error('MCP_SECRET (32+ chars) is required in http mode');
    process.exit(1);
  }
  const secret = Buffer.from(MCP_SECRET);
  const matches = value => {
    const given = Buffer.from(value || '');
    return given.length === secret.length && timingSafeEqual(given, secret);
  };

  createServer(async (req, res) => {
    let pathname;
    try {
      ({ pathname } = new URL(req.url, 'http://localhost'));
    } catch {
      return res.writeHead(400).end();
    }
    if (pathname === '/health') return res.writeHead(200).end('ok');

    // Claude Code sends the secret as a Bearer header; ChatGPT (no-auth connector) carries it in the URL.
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const given = pathname === '/mcp' ? bearer : pathname.startsWith('/mcp/') && pathname.slice(5);
    if (!matches(given)) {
      return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}');
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end();
    }
  }).listen(Number(PORT), () => console.error(`chatwoot-mcp listening on :${PORT}`));
} else {
  await buildServer().connect(new StdioServerTransport());
}
