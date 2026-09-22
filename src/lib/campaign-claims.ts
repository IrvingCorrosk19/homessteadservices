const FORBIDDEN = [
  { re: /\b24\s*\/\s*7\b|\blas 24 horas\b|\btodo el d[ií]a\b/i, id: "availability_247" },
  { re: /\bgarant[ií]a\b/i, id: "guarantee" },
  { re: /\$\s*\d|\bB\/\.\s*\d|\bprecio\s+(desde|fijo|solo)\b/i, id: "price" },
  { re: /\btestimonio|\bnuestro cliente dijo|\b5 estrellas\b/i, id: "testimonial" },
  { re: /\bel mejor de panam|\bn[uú]mero 1\b|\bl[ií]der (del )?mercado\b/i, id: "superlative" },
  { re: /\bdescuento|\boferta por tiempo|\bquedan \d+ cupos|\bultimo cupo\b/i, id: "false_urgency" },
  { re: /\btrabajo real\b|\binstalamos esta cerradura\b|\bfoto del trabajo\b/i, id: "fake_job_photo" },
  { re: /\bneuromarketing|\bhackeamos tu cerebro|\bpsicolog[ií]a oscura\b/i, id: "pseudoscience" },
];

export function scanCommercialClaims(text: string) {
  const hits = FORBIDDEN.filter((item) => item.re.test(text)).map((item) => item.id);
  return { ok: hits.length === 0, hits };
}

export function editorialScore(input: {
  hook: string;
  problem: string;
  benefit: string;
  cta: string;
  objection: string;
  local: boolean;
  processVisible: boolean;
}) {
  let score = 0;
  if (input.hook.trim().length >= 12) score += 15;
  if (input.problem.trim().length >= 12) score += 15;
  if (input.benefit.trim().length >= 12) score += 15;
  if (input.cta.trim().length >= 8) score += 15;
  if (input.objection.trim().length >= 8) score += 10;
  if (input.local) score += 15;
  if (input.processVisible) score += 15;
  const claims = scanCommercialClaims(
    [input.hook, input.problem, input.benefit, input.cta, input.objection].join("\n"),
  );
  if (!claims.ok) score = Math.min(score, 40);
  return {
    score,
    claims,
    label: "revisión editorial interna — no predice ventas ni viralidad",
  };
}
