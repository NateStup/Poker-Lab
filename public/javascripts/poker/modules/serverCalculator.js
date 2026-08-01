export async function calculateEquityOnServer(payload) {
  const response = await fetch('/api/poker/equity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Server calculation failed');
  }

  return response.json();
}
