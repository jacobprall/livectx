# livectx as a Context Runtime

*Date: May 11, 2026*

While `livectx` is often introduced as "TanStack Query for prompt assembly" (focusing on developer experience, caching, and declarative data fetching), its deeper architectural value is acting as a **context runtime** for LLM agents. 

## The Mental Model Shift

In most agent frameworks, an agent's capabilities are static code:
`Agent = hardcoded system prompt + hardcoded tool list + hardcoded data sources`

In `livectx`, capabilities are runtime data:
`Agent = bindings (perception) + tools (capabilities) + template (worldview)`

Because bindings and templates are just objects that can be created, composed, shared, and modified at runtime, an agent's entire context surface becomes something that can be **provisioned programmatically**—including by another agent.

## Agents Provisioning Agents

This runtime nature enables a powerful pattern: meta-agents dynamically spinning up specialized sub-agents. 

Instead of writing a new agent class for every task, a meta-agent can:
1. Determine what data a sub-agent needs to see.
2. Dynamically instantiate `source()` bindings for that specific data.
3. Dynamically instantiate `tool()` bindings for the actions the sub-agent is allowed to take.
4. Compose a `prompt` template that wires these together.

## MCP as the Provisioning Protocol

The most natural implementation of this pattern uses the Model Context Protocol (MCP) bridge. 

A meta-agent creates bindings describing a sub-agent's world, exposes them as an MCP server (`exposeAsMcpServer`), and the sub-agent connects to discover its own capabilities (`mcpClient` + `mcpResources` + `mcpTools`). The sub-agent doesn't need to know how its context was provisioned—it just assembles what it finds.

## The Analogy: Terraform for Agent Capabilities

If Terraform lets you declare infrastructure resources that the system provisions, `livectx` lets you declare context bindings that the system resolves, caches, and assembles. 

It is the infrastructure layer that turns an agent's context surface from hardcoded strings into composable, shareable, live infrastructure. It defines what an agent can perceive and do, then manages that as live infrastructure—provisioned, cached, invalidated, and composable at runtime.