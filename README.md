# @pipeworx/ebird

eBird MCP — Cornell Lab bird sightings.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `recent_observations(region_code, species_code?, back?, max_results?, include_provisional?)`
- `recent_notable(region_code, back?, max_results?, detail?)`
- `nearby_observations(latitude, longitude, dist_km?, back?, max_results?, species_code?)`
- `find_species(query)`
- `list_subregions(region_type, parent_region_code?)`

## Auth

- **Platform key:** gateway env `PLATFORM_EBIRD_KEY`.
- **BYO:** `?_apiKey=<token>` after registering at https://ebird.org/api/keygen (free).

## Data source

`https://api.ebird.org/v2` — header `X-eBirdApiToken`.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "ebird": {
      "url": "https://gateway.pipeworx.io/ebird/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Ebird data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
