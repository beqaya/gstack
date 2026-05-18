export function envVarName(provider: string, secretName: string): string {
  return `GSTACK_RUNTIME_${provider.toUpperCase()}_${secretName.toUpperCase()}`;
}

export function readEnv(provider: string, secretName: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = envVarName(provider, secretName);
  const value = env[name];
  return value && value.length > 0 ? value : null;
}
