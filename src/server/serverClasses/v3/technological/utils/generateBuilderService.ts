export const generateBuilderService = (
  configKey: string,
  configValue: any,
  mode: string,
): any => {
  const runtime = configValue.runtime || 'node';
  const testsJson = JSON.stringify(configValue.tests || []);
  const outputsJson = JSON.stringify(configValue.outputs || []);

  const commandMap: Record<string, string> = {
    node: `bun /workspace/testeranto/node_runtime.ts /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/node/node.mjs '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    web: `bun /workspace/testeranto/web_runtime.ts /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/web/web.mjs '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    ruby: `ruby /workspace/testeranto/ruby_runtime.rb /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/ruby/ruby.rb '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    golang: `go run /workspace/testeranto/golang_runtime.go /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/golang/golang.mjs '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    rust: `cargo run --manifest-path /workspace/testeranto/rust_builder/Cargo.toml -- /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/rust/rust.mjs '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    python: `python3 /workspace/testeranto/python_runtime.py /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/python/python.mjs '{"name":"${configKey}","tests":${testsJson},"outputs":${outputsJson}}'`,
    // java: `sh -c "cd /workspace && javac -cp \\".:lib/*\\" testeranto/*.java && java -cp \\"testeranto:.:lib/*\\" java_runtime /workspace/testeranto/testeranto.ts /workspace/testeranto/runtimes/java/java.mjs '{\\"name\\":\\"${configKey}\\",\\"tests\\":${testsJson},\\"outputs\\":${outputsJson}}'"`,
  };

  const command = commandMap[runtime] || commandMap.node;

  return {
    container_name: `${configKey}-builder`,
    environment: {
      NODE_ENV: 'production',
      ENV: runtime,
      MODE: mode,
    },
    working_dir: '/workspace',
    volumes: [
      `../src:/workspace/src`,
      `../dist:/workspace/dist`,
      `../testeranto:/workspace/testeranto`,
    ],
    command,
    networks: ['allTests_network'],
    restart: 'no',
    image: `testeranto-${runtime}-${configKey}:latest`,
    extra_hosts: {
      'host.docker.internal': 'host-gateway',
    },
  };
};
