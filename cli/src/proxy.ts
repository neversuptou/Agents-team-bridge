import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { confirmOutgoing } from "./gate.js";
import { checkHubUrl, hubFetch } from "./http.js";

class NoElicitation extends Error {}
const PREVIEW_TOOL = "request_preview";
const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

/*
  Локальный MCP-сервер проекта (stdio) между Claude Code и хабом.
  Пересылает только то, что Claude явно передал в вызов инструмента; всё исходящее — после подтверждения человеком.
  Токен берётся из ~/.teambridge и в Claude не попадает.
*/
export async function createProxy(o: { hub: string; token: string; ca?: string }) {
  const url = new URL("/mcp", checkHubUrl(o.hub));
  const upstream = new Client({ name: "teambridge-proxy", version: "0.2.1" });
  await upstream.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${o.token}` } }, fetch: hubFetch(o.ca),
  }));
  const server = new Server({ name: "teambridge", version: "0.2.1" }, { capabilities: { tools: {} }, instructions: upstream.getInstructions() });

  const elicit = async (message: string) => {
    if (!server.getClientCapabilities()?.elicitation) throw new NoElicitation();
    const r = await server.elicitInput({
      message,
      requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Да, отправить", description: "Отметьте, чтобы подтвердить" } }, required: ["confirm"] },
    });
    return r.action === "accept" && r.content?.confirm === true;
  };

  // текст непринятого запроса — только в окно человеку; сам инструмент Claude не показываем
  const preview = async (threadId: number) => {
    const r: any = await upstream.callTool({ name: PREVIEW_TOOL, arguments: { thread_id: threadId } });
    return r.isError ? null : (JSON.parse(r.content?.[0]?.text ?? "{}").question ?? null);
  };

  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    const r = await upstream.listTools(req.params);
    return { ...r, tools: r.tools.filter((t) => t.name !== PREVIEW_TOOL) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const gate = await confirmOutgoing(req.params.name, req.params.arguments ?? {}, elicit, preview);
      if (!gate.ok) return fail(gate.reason);
    } catch (e) {
      if (e instanceof NoElicitation) return fail("Отправка невозможна: этот Claude Code не показывает окно подтверждения (MCP elicitation). Обновите Claude Code (`claude update`).");
      throw e;
    }
    return upstream.callTool(req.params);
  });
  return server;
}
