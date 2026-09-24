export async function ask(config, prompt, fetcher = fetch) {
  if (!config.openaiApiKey || !config.openaiModel)
    throw new Error('The host must configure openaiApiKey and openaiModel before enabling /ask.');
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.openaiModel,
      input: prompt,
      max_output_tokens: 600,
      store: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok)
    throw new Error(
      `AI service returned HTTP ${response.status}; check the key, model access, billing, or rate limit.`,
    );
  const data = await response.json();
  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('\n') || 'No text response returned.'
  );
}
