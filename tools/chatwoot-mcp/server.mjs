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
  const server = new McpServer({ name: 'chatwoot', version: '0.2.0' });

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
