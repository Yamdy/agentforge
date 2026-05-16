// Test fixture: valid plugin that exports a factory function
export default function testPlugin(api) {
  api.registerTool({
    name: 'fixture-tool',
    description: 'Tool from test fixture',
    inputSchema: {},
  });
}
