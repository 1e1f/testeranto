export const nodeBddCommand = (
  fpath: string,
  nodeConfigPath: string,
  configKey: string,
) => {
  const originalPath = fpath.replace(/\.mjs$/, '.ts');

  const jsonStr = JSON.stringify({
    ports: [1111],
    fs: `testeranto/reports/${configKey}/${originalPath}/`,
  });
  return `bun testeranto/bundles/${configKey}/${fpath} '${jsonStr}'`;
};
