export const generateCheckService = (
  configKey: string,
  configValue: any,
  testName: string,
  checkIndex: number,
): any => {
  const cleanTestName = testName
    .replace(/\//g, '_')
    .replace(/\./g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();

  const serviceConfig: any = {
    build: {
      context: process.cwd(),
      dockerfile: `testeranto/runtimes/${configValue.runtime || 'node'}/${configValue.runtime || 'node'}.Dockerfile`,
    },
    container_name: `${configKey}-${cleanTestName}-check-${checkIndex}`,
    working_dir: '/workspace',
    volumes: [
      `${process.cwd()}/src:/workspace/src`,
      `${process.cwd()}/test:/workspace/test`,
      `${process.cwd()}/SOUL.md:/workspace/SOUL.md`,
      `${process.cwd()}/testeranto:/workspace/testeranto`,
    ],
    command: `bun testeranto/bundles/${configKey}/${testName}_check_${checkIndex}.mjs '{"ports":[1111],"fs":"testeranto/reports/${configKey}/${testName}/"}'`,
    networks: ['allTests_network'],
    restart: 'no',
    extra_hosts: {
      'host.docker.internal': 'host-gateway',
    },
  };

  return serviceConfig;
};
