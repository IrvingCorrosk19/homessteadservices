import { homesteadBrandDossier } from "@/lib/campaign-brand";
import { editorialScore } from "@/lib/campaign-claims";
import type { PieceFormat, PiecePillar } from "@/lib/campaign-types";
import { images } from "@/data/images";

export type PieceDraft = {
  key: string;
  pillar: PiecePillar;
  format: PieceFormat;
  objective: string;
  problem: string;
  hook: string;
  benefit: string;
  evidence: string;
  objection: string;
  visualNeed: string;
  sourceImage: string;
  copy: string;
  altCopy: string;
  overlayText: string;
  cta: string;
  altText: string;
  hypothesis: string;
  publishable: boolean;
  videoStatus?: "script_ready" | "video_generated" | "video_publishable";
  shots?: string[];
};

function areaLabel() {
  const dossier = homesteadBrandDossier();
  if (dossier.serviceArea.status === "confirmed" && dossier.serviceArea.value) {
    return dossier.serviceArea.value;
  }
  return "Panamá";
}

export function digitalLocksmithPilotDrafts(): PieceDraft[] {
  const area = areaLabel();
  const process =
    "Cuéntanos qué necesitas y, si puedes, envía fotos. Revisamos tu solicitud y coordinamos los siguientes pasos. Luego realizamos el servicio acordado.";
  const evidence =
    "Foto ilustrativa de cerrajería (no es un trabajo documentado de Homestead). El proceso publicado: solicitud → coordinación → servicio.";
  const baseScoreInput = (piece: Pick<PieceDraft, "hook" | "problem" | "benefit" | "cta" | "objection">) =>
    editorialScore({
      hook: piece.hook,
      problem: piece.problem,
      benefit: piece.benefit,
      cta: piece.cta,
      objection: piece.objection,
      local: true,
      processVisible: true,
    });
  void baseScoreInput;
  void process;

  const pieces: PieceDraft[] = [
    {
      key: "keys",
      pillar: "discovery",
      format: "SINGLE_IMAGE",
      objective: "Que un propietario reconozca el problema cotidiano y pida evaluación de instalación.",
      problem: "Llegar a casa y buscar entre varias llaves, o dejar una copia con alguien de confianza.",
      hook: "¿Otra vez buscando la llave en el fondo del bolso?",
      benefit: "Una cerradura digital puede abrir con código o huella, sin cargar un manojo extra.",
      evidence,
      objection: "No prometemos una marca. Primero vemos si tu puerta admite el cambio.",
      visualNeed: "Foto ilustrativa de cerradura moderna + texto corto legible en móvil.",
      sourceImage: images.services.locksmith,
      overlayText: "¿Otra vez buscando la llave?",
      copy: [
        `¿Te pasa que llegas a casa con las manos ocupadas y la llave está en el fondo del bolso?`,
        ``,
        `En Homestead evaluamos e instalamos cerraduras digitales en ${area}.`,
        `No vendemos por foto: vemos tu puerta y te decimos si el cambio es viable.`,
        ``,
        `Solicita la evaluación en el enlace. Te explicamos el siguiente paso al recibirlo.`,
      ].join("\n"),
      altCopy: [
        `Menos llaves en el llavero. Más comodidad al entrar.`,
        `Homestead revisa tu puerta en ${area} y coordina la instalación si aplica.`,
      ].join("\n"),
      cta: "Solicita evaluación de instalación",
      altText: "Imagen ilustrativa de una cerradura moderna. No representa un trabajo realizado por Homestead.",
      hypothesis: "Un problema cotidiano de comodidad genera más solicitudes que hablar de control de acceso.",
      publishable: true,
    },
    {
      key: "evaluate",
      pillar: "explain",
      format: "SINGLE_IMAGE",
      objective: "Explicar qué ocurre al solicitar, para bajar incertidumbre.",
      problem: "No sabe si su puerta sirve ni qué tiene que enviar.",
      hook: "¿Sirve mi puerta para una cerradura digital?",
      benefit: "Con fotos del frente, el canto y el interior de la puerta podemos orientar la viabilidad.",
      evidence: "El formulario de Homestead pide esas tres vistas para instalación de cerradura digital.",
      objection: "No instalamos a ciegas ni confirmamos compatibilidad sin ver la puerta.",
      visualNeed: "Misma foto ilustrativa; overlay de la pregunta de viabilidad.",
      sourceImage: images.services.locksmith,
      overlayText: "¿Sirve tu puerta?",
      copy: [
        `Si estás pensando en instalar una cerradura digital, el primer paso no es comprar el dispositivo.`,
        ``,
        `En Homestead te pedimos fotos de la puerta (frente, canto e interior) para ver si el cambio es viable.`,
        `Después coordinamos la visita o te indicamos qué falta.`,
        ``,
        `Así evitas comprar algo que no calza en tu chapa actual.`,
      ].join("\n"),
      altCopy: [
        `Tres fotos de la puerta. Una orientación clara.`,
        `Homestead no confirma instalación sin ver el estado de la chapa.`,
      ].join("\n"),
      cta: "Enviar fotos y solicitar evaluación",
      altText: "Imagen ilustrativa de cerrajería. Homestead evalúa la puerta real del cliente antes de instalar.",
      hypothesis: "Explicar el requisito de fotos reduce abandonos del formulario de cerradura digital.",
      publishable: true,
    },
    {
      key: "process",
      pillar: "trust",
      format: "SINGLE_IMAGE",
      objective: "Mostrar el proceso real publicado, sin testimonios inventados.",
      problem: "No sabe qué pasa después de llenar el formulario.",
      hook: "Así coordinamos un servicio de Homestead.",
      benefit: "Hay un camino visible: nos cuentas, coordinamos, atendemos y revisamos el trabajo acordado.",
      evidence: "Pasos publicados en homestead.lat: Cuéntanos → Coordinamos → Atendemos → Listo.",
      objection: "No hay tiempos de llegada prometidos ni servicio de madrugada.",
      visualNeed: "Composición con proceso en texto; foto ilustrativa de fondo.",
      sourceImage: images.services.locksmith,
      overlayText: "Un paso a la vez",
      copy: [
        `Así trabajamos en Homestead:`,
        ``,
        `1. Nos cuentas qué necesitas y, si puedes, envías fotografías.`,
        `2. Revisamos tu solicitud y coordinamos contigo los siguientes pasos.`,
        `3. Realizamos el servicio acordado.`,
        `4. Revisamos contigo el trabajo.`,
        ``,
        `Para una cerradura digital, el punto de partida es la evaluación de tu puerta.`,
      ].join("\n"),
      altCopy: [
        `Solicitud. Coordinación. Servicio acordado.`,
        `Sin sorpresas de proceso: te decimos qué sigue al recibir tu caso.`,
      ].join("\n"),
      cta: "Empezar por la solicitud",
      altText: "Composición ilustrativa. El proceso descrito es el publicado por Homestead, no una garantía de plazos.",
      hypothesis: "Hacer visible el proceso aumenta solicitudes completas frente a un anuncio solo de producto.",
      publishable: true,
    },
    {
      key: "compatibility",
      pillar: "explain",
      format: "SINGLE_IMAGE",
      objective: "Resolver la objeción de compatibilidad sin inventar marcas ni resultados.",
      problem: "Teme comprar una cerradura que no calza o dejar la puerta insegura a medias.",
      hook: "No hace falta adivinar si tu chapa se puede cambiar.",
      benefit: "La evaluación sirve para ver el estado de la puerta antes de hablar de instalación.",
      evidence: "Flujo de solicitud de instalación de cerradura digital con evidencia fotográfica.",
      objection: "Homestead no cotiza un modelo concreto ni un precio desde el anuncio.",
      visualNeed: "Foto ilustrativa; overlay de objeción de compatibilidad.",
      sourceImage: images.services.locksmith,
      overlayText: "Primero vemos tu puerta",
      copy: [
        `Una duda frecuente: “¿y si mi puerta no sirve para una cerradura digital?”`,
        ``,
        `Por eso Homestead empieza por verla. Con las fotos podemos orientar si conviene una visita.`,
        `El alcance y el costo se definen después, no en el anuncio.`,
        ``,
        `Si no es viable, te lo decimos. No empujamos una instalación a ciegas.`,
      ].join("\n"),
      altCopy: [
        `La puerta manda. El anuncio no sustituye una revisión.`,
        `Pide la evaluación y te decimos el siguiente paso real.`,
      ].join("\n"),
      cta: "Pedir revisión de la puerta",
      altText: "Imagen ilustrativa. No muestra una instalación concreta de Homestead.",
      hypothesis: "Nombrar la objeción de compatibilidad genera más solicitudes calificadas que omitirla.",
      publishable: true,
    },
    {
      key: "ask",
      pillar: "ask",
      format: "SINGLE_IMAGE",
      objective: "Pedir la solicitud de instalación con una sola acción.",
      problem: "Ya entendió el servicio y necesita un siguiente paso simple.",
      hook: "Cuando quieras dejar de depender de esa copia extra de la llave.",
      benefit: "Una solicitud basta para iniciar la evaluación de instalación en tu propiedad.",
      evidence: "Canal confirmado: formulario web de cerrajería / WhatsApp oficial.",
      objection: "No hay descuento, cupo ni fecha límite inventados.",
      visualNeed: "CTA dominante, un solo mensaje, logo visible.",
      sourceImage: images.services.locksmith,
      overlayText: "Evalúa tu instalación",
      copy: [
        `Si quieres instalar una cerradura digital en tu casa o apartamento, el siguiente paso es una solicitud.`,
        ``,
        `Homestead recibe el caso, revisa lo que envíes y te coordina el siguiente paso.`,
        `Una acción. Sin presión de “últimos cupos”.`,
      ].join("\n"),
      altCopy: [
        `Solicita la evaluación de instalación cuando te quede cómodo.`,
        `Te respondemos sobre tu caso, no con un paquete genérico.`,
      ].join("\n"),
      cta: "Solicitar instalación",
      altText: "Llamado a solicitar evaluación de cerradura digital. Imagen ilustrativa, no un trabajo real.",
      hypothesis: "Un CTA único de solicitud convierte mejor que mezclar WhatsApp, web y teléfono en el mismo recuadro.",
      publishable: true,
    },
    {
      key: "reel",
      pillar: "discovery",
      format: "REEL_SCRIPT",
      objective: "Dejar listo un guion de reel. No hay video generado ni publicable en esta fase.",
      problem: "Buscar la llave al llegar a casa.",
      hook: "Manos ocupadas. Llave escondida. Puerta cerrada.",
      benefit: "Mostrar la situación y el siguiente paso real: pedir evaluación.",
      evidence: "Ninguna toma de un trabajo Homestead autenticado en archivo.",
      objection: "Un prompt no es un reel. No se publica como video.",
      visualNeed: "Tomas reales pendientes. No generar video con IA ni fingir una instalación.",
      sourceImage: images.services.locksmith,
      overlayText: "Guion — no es video",
      copy: [
        "GUION REEL (15–20 s) — ESTADO: script_ready",
        "Toma 1 (3s): manos con bolsas frente a una puerta. No mostrar caras de clientes.",
        "Toma 2 (4s): llavero, búsqueda de la llave. Situación cotidiana.",
        "Toma 3 (5s): overlay ‘Evaluamos tu puerta antes de instalar’.",
        "Toma 4 (5s): end card Homestead + ‘Solicita en homestead.lat’ + WhatsApp oficial.",
        "Recursos pendientes: grabación propia. Prohibido presentar stock o IA como instalación real.",
      ].join("\n"),
      altCopy: "",
      cta: "No publicable como video en esta versión",
      altText: "Guion de video. No existe archivo de reel publicable.",
      hypothesis: "Un reel de situación cotidiana podría ampliar descubrimiento; aún no hay evidencia propia.",
      publishable: false,
      videoStatus: "script_ready",
      shots: [
        "Manos con bolsas / puerta (pendiente de grabar)",
        "Detalle de llavero (pendiente de grabar)",
        "Texto de evaluación de puerta",
        "End card de marca + destino web",
      ],
    },
  ];
  return pieces;
}

export function tokenizeForSimilarity(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-záéíóúñü0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

export function jaccard(a: Set<string>, b: Set<string>) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function similarityHits(drafts: PieceDraft[]) {
  const publishable = drafts.filter((item) => item.format === "SINGLE_IMAGE");
  const hits: Array<{ a: string; b: string; overlay: number; copy: number }> = [];
  for (let i = 0; i < publishable.length; i += 1) {
    for (let j = i + 1; j < publishable.length; j += 1) {
      const overlay = jaccard(
        tokenizeForSimilarity(publishable[i].overlayText),
        tokenizeForSimilarity(publishable[j].overlayText),
      );
      const copy = jaccard(tokenizeForSimilarity(publishable[i].copy), tokenizeForSimilarity(publishable[j].copy));
      if (overlay >= 0.55 || copy >= 0.62) {
        hits.push({ a: publishable[i].key, b: publishable[j].key, overlay, copy });
      }
    }
  }
  return hits;
}
