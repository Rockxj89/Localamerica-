// Shows each failed check as an error on the GitHub run page (a "::error" line), next to the normal output.
export default async function* githubErrors(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const err = event.data.details?.error;
    const message = String(err?.cause?.message || err?.message || err || 'failed');
    const clean = (s) => s.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
    yield `::error title=${clean(String(event.data.name)).replace(/[:,]/g, ' ')}::${clean(message).slice(0, 2000)}\n`;
  }
}
