# chatwoot-mcp

Servidor MCP mínimo para conectar Claude Code, Claude (web/desktop) o ChatGPT a nuestra instancia de Chatwoot (`https://crm.grupodines.com`). Usa la API de agente de Chatwoot con un token de acceso.

## Herramientas

| Herramienta | Qué hace | Visible para el cliente |
| --- | --- | --- |
| `chatwoot_list_inboxes` | Lista las bandejas (canales) | No |
| `chatwoot_list_conversations` | Lista conversaciones por estado, asignación, bandeja, etiquetas o texto (`q`) | No |
| `chatwoot_get_conversation` | Trae una conversación con sus últimos 20 mensajes (paginable con `before_message_id`) | No |
| `chatwoot_add_private_note` | Agrega una nota privada interna | No |
| `chatwoot_send_reply` | Envía una respuesta al cliente por su canal | **Sí** |

`chatwoot_send_reply` solo existe si se define `CHATWOOT_ALLOW_SEND=true`. Por defecto el servidor no puede escribirle a ningún cliente.

## Uso remoto (recomendado)

El servidor corre en Easypanel (proyecto `chatwoot`, servicio `chatwoot-mcp`) y se publica en `https://crm.grupodines.com/mcp`. Nadie tiene que instalar nada en su PC.

Variables del servicio:

| Variable | Valor |
| --- | --- |
| `CHATWOOT_URL` | `https://crm.grupodines.com` |
| `CHATWOOT_ACCOUNT_ID` | `1` |
| `CHATWOOT_API_TOKEN` | Token del agente dedicado (ver abajo) |
| `MCP_SECRET` | Clave larga aleatoria (32+ caracteres) que protege el acceso |
| `CHATWOOT_ALLOW_SEND` | Dejar vacío. Solo `true` si se quiere permitir responder a clientes |

El token de Chatwoot conviene que sea de un agente dedicado (por ejemplo "Asistente Claude"), sumado solo a las bandejas que necesite: así lo que haga queda firmado con ese agente y solo ve esas bandejas. Se copia desde **Perfil → Token de acceso** de ese agente.

### Claude Code

```bash
claude mcp add --transport http --scope user chatwoot https://crm.grupodines.com/mcp --header "Authorization: Bearer <MCP_SECRET>"
```

### ChatGPT o Claude web/desktop

Agregá un conector personalizado con esta URL y sin autenticación:

```
https://crm.grupodines.com/mcp/<MCP_SECRET>
```

- ChatGPT: Configuración → Aplicaciones y conectores → modo desarrollador → Crear (o "Agregar servidor MCP personalizado").
- Claude: Configuración → Conectores → Agregar conector personalizado.

La URL con la clave da acceso a las conversaciones: no la compartas. Si se filtra, cambiá `MCP_SECRET` en Easypanel y volvé a desplegar; la URL vieja deja de funcionar.

## Uso local (alternativo)

Requiere Node.js 18 o superior y el token del agente.

### Instalación

```bash
cd tools/chatwoot-mcp
npm install
```

### Claude Code

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

### Claude Desktop

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
