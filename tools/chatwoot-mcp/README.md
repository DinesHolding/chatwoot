# chatwoot-mcp

Servidor MCP mínimo (stdio) para conectar Claude Code o Claude Desktop a nuestra instancia de Chatwoot (`https://crm.grupodines.com`). Usa la API de agente de Chatwoot con un token de acceso.

## Herramientas

| Herramienta | Qué hace | Visible para el cliente |
| --- | --- | --- |
| `chatwoot_list_inboxes` | Lista las bandejas (canales) | No |
| `chatwoot_list_conversations` | Lista conversaciones por estado, asignación, bandeja, etiquetas o texto (`q`) | No |
| `chatwoot_get_conversation` | Trae una conversación con sus últimos 20 mensajes (paginable con `before_message_id`) | No |
| `chatwoot_add_private_note` | Agrega una nota privada interna | No |
| `chatwoot_send_reply` | Envía una respuesta al cliente por su canal | **Sí** |

`chatwoot_send_reply` solo existe si se define `CHATWOOT_ALLOW_SEND=true`. Por defecto el servidor no puede escribirle a ningún cliente.

## Requisitos

- Node.js 18 o superior.
- Un token de acceso de Chatwoot. Recomendado: crear un agente dedicado (por ejemplo "Asistente Claude"), sumarlo solo a las bandejas que necesite y usar su token desde **Perfil → Token de acceso**. Así todo lo que haga queda firmado con ese agente y solo ve esas bandejas.
- El ID de cuenta, que aparece en la URL del panel: `.../app/accounts/<ID>/...`.

## Instalación

```bash
cd tools/chatwoot-mcp
npm install
```

## Conectar a Claude Code

```bash
claude mcp add chatwoot --scope user \
  -e CHATWOOT_URL=https://crm.grupodines.com \
  -e CHATWOOT_ACCOUNT_ID=1 \
  -e CHATWOOT_API_TOKEN=<token> \
  -- node /ruta/a/tools/chatwoot-mcp/server.mjs
```

En Windows usá la ruta completa, por ejemplo `node C:\\ruta\\tools\\chatwoot-mcp\\server.mjs`. El token queda en la configuración local de Claude Code (`~/.claude.json`), no en el repositorio.

Si habilitás `CHATWOOT_ALLOW_SEND=true`, forzá la confirmación antes de cada envío agregando esto a `~/.claude/settings.json`:

```json
{
  "permissions": {
    "ask": ["mcp__chatwoot__chatwoot_send_reply"]
  }
}
```

## Conectar a Claude Desktop

En `claude_desktop_config.json` (Configuración → Desarrollador → Editar configuración):

```json
{
  "mcpServers": {
    "chatwoot": {
      "command": "node",
      "args": ["C:\\ruta\\tools\\chatwoot-mcp\\server.mjs"],
      "env": {
        "CHATWOOT_URL": "https://crm.grupodines.com",
        "CHATWOOT_ACCOUNT_ID": "1",
        "CHATWOOT_API_TOKEN": "<token>"
      }
    }
  }
}
```

Claude Desktop pide permiso la primera vez que se usa cada herramienta. Para `chatwoot_send_reply` elegí "Permitir una vez", nunca "Permitir siempre".
