export const generateCheckService = (
  configKey: string,
  configValue: any,
  testName: string,
  checkIndex: number,
): any => {
  const runtime = configValue.runtime || 'node';

  const cleanTestName = testName
    .replace(/\//g, '_')
    .replace(/\./g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();

  const extensionMap: Record<string, string> = {
    node: 'mjs',
    web: 'mjs',
    golang: 'go',
    ruby: 'rb',
    java: 'java',
    rust: 'rs',
    python: 'py',
  };

  const ext = extensionMap[runtime] || 'mjs';

  const commandMap: Record<string, string> = {
    node: `bun testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.${ext} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    web: `bun testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.${ext} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    ruby: `ruby testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.${ext} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    golang: `go run testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.${ext} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    rust: `./testeranto/bundles/${configKey}/${testName}_check_${checkIndex} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    python: `python3 testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.${ext} '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    // java: `java -jar testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.jar '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
  };

  const command = commandMap[runtime] || commandMap.node;

  const serviceConfig: any = {
    build: {
      context: '..',
      dockerfile: `testeranto/runtimes/${runtime}/${runtime}.Dockerfile`,
    },
    container_name: `${configKey}-${cleanTestName}-check-${checkIndex}`,
    working_dir: '/workspace',
    volumes: [
      `../src:/workspace/src`,
      `../test:/workspace/test`,
      `../SOUL.md:/workspace/SOUL.md`,
      `../testeranto:/workspace/testeranto`,
    ],
    command: command,
    networks: ['allTests_network'],
    restart: 'no',
    extra_hosts: {
      'host.docker.internal': 'host-gateway',
    },
  };

  return serviceConfig;
};
