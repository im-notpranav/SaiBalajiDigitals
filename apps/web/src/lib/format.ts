export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatSft(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

export function computeLineItem(width: number, height: number, qty: number, rate: number) {
  if (width <= 0 || height <= 0 || qty <= 0 || rate <= 0) {
    return { total_sft: null as number | null, amount: null as number | null };
  }
  const total_sft = Number(((width * height) / 144 * qty).toFixed(2));
  const amount = Number((total_sft * rate).toFixed(2));
  return { total_sft, amount };
}
