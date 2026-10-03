# controlCopyFromContext — comportamiento real

- **No invoca modelo LLM.** En aislado `OPENAI_API_KEY` está vacío.
- Con nota: ensambla plantilla local (`${context} + folio + CTA Homestead`).
- Sin nota: plantilla genérica / `isolatedCopyFallback`.
- Fallo de proveedor: no aplica (no hay llamada); el texto se construye en proceso.
- Contexto y texto editado: `description` / copy versionado; `save_copy` / `update_ai_context` / reorder invalidan aprobación.

No llamar a esto "generación IA" en UX ni en informes.
