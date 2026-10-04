import type { FormService, PropertyType, ServiceSlug } from "@/lib/site";

export type Dictionary = {
  meta: {
    homeTitle: string;
    homeDescription: string;
    servicesTitle: string;
    servicesDescription: string;
    contactTitle: string;
    contactDescription: string;
  };
  nav: {
    home: string;
    services: string;
    process: string;
    contact: string;
  };
  common: {
    request: string;
    whatsapp: string;
    consultWhatsApp: string;
    writeWhatsApp: string;
    call: string;
    representativeNote: string;
    comingSoon: string;
  };
  hero: {
    title: string;
    subtitle: string;
    chips: string;
  };
  services: {
    title: string;
    intro: string;
    items: Record<
      ServiceSlug,
      { title: string; description: string; cta: string }
    >;
  };
  integrated: {
    title: string;
    body: string;
    items: string[];
    equals: string;
    cta: string;
  };
  ac: {
    title: string;
    body: string;
    items: string[];
    cta: string;
  };
  process: {
    title: string;
    steps: { number: string; title: string; body: string }[];
  };
  scheduled: {
    title: string;
    body: string;
    applies: string;
    items: string[];
    cta: string;
  };
  trust: {
    title: string;
    items: { title: string; body: string }[];
  };
  cta: {
    title: string;
    body: string;
    request: string;
    whatsapp: string;
  };
  contact: {
    title: string;
    body: string;
    whatsapp: string;
    phone: string;
    email: string;
    hours: string;
    area: string;
    pending: string;
  };
  form: {
    title: string;
    body: string;
    name: string;
    phone: string;
    email: string;
    property: string;
    service: string;
    message: string;
    messagePlaceholder: string;
    messageHelp: string;
    messageExampleLabel: string;
    messageMinHint: string;
    messageRemaining: string;
    upload: string;
    uploadRequired: string;
    uploadHint: string;
    uploadOptionalHint: string;
    removePhoto: string;
    locksmithIntent: string;
    reviewingPhotos: string;
    uploadingPhotos: string;
    submit: string;
    sending: string;
    slowSubmit: string;
    uncertainSubmit: string;
    formErrorBanner: string;
    successTitle: string;
    successBody: string;
    successFolio: string;
    successCopyFolio: string;
    successCopied: string;
    successSummary: string;
    successNextStep: string;
    successAnother: string;
    errorTitle: string;
    errorBody: string;
    propertyOptions: Record<PropertyType, string>;
    serviceOptions: Record<FormService, string>;
    errors: {
      name: string;
      phone: string;
      email: string;
      property: string;
      service: string;
      message: string;
      messageQuality: string;
      files: string;
      intent: string;
      digitalLockPhotos: string;
      digitalLockMissing: string;
    };
  };
  whatsapp: {
    label: string;
    defaultMessage: string;
    headerMessage: string;
    serviceMessage: string;
    floatLabel: string;
  };
  social: {
    follow: string;
    soon: string;
  };
  footer: {
    rights: string;
    note: string;
  };
  notFound: {
    title: string;
    body: string;
    home: string;
  };
};

export const es: Dictionary = {
  meta: {
    homeTitle: "HOMESTEAD SERVICES | Mantenimiento y reparaciones en Panamá",
    homeDescription:
      "Mantenimiento, reparaciones y mejoras para hogares, apartamentos, oficinas y pequeños comercios en Panamá. Aire acondicionado, plomería, pintura, electricidad, cerrajería y más.",
    servicesTitle: "Servicios de mantenimiento y reparación",
    servicesDescription:
      "Aire acondicionado, plomería, pintura, electricidad, cerrajería, reparaciones generales y pequeñas remodelaciones en Panamá.",
    contactTitle: "Solicitar servicio",
    contactDescription:
      "Cuéntanos qué necesita tu propiedad. Puedes describir el problema y enviar fotografías para coordinar tu servicio en Panamá.",
  },
  nav: {
    home: "Inicio",
    services: "Servicios",
    process: "Cómo funciona",
    contact: "Contacto",
  },
  common: {
    request: "Solicitar servicio",
    whatsapp: "WhatsApp",
    consultWhatsApp: "Escribir por WhatsApp",
    writeWhatsApp: "Escribir por WhatsApp",
    call: "Llamar",
    representativeNote: "Imagen representativa del servicio",
    comingSoon: "Por confirmar",
  },
  hero: {
    title: "Tu hogar en buenas manos.",
    subtitle:
      "Instalamos, reparamos y damos mantenimiento a tu hogar o negocio: aire acondicionado, plomería, pintura, electricidad, cerrajería y remodelación.",
    chips:
      "Aire acondicionado • Plomería • Pintura • Electricidad • Cerrajería • Remodelación",
  },
  services: {
    title: "Servicios para tu espacio",
    intro:
      "Instalación, reparación, mantenimiento y pequeñas mejoras. Elige lo que necesitas y te ayudamos a coordinar el siguiente paso.",
    items: {
      ac: {
        title: "Aire acondicionado",
        description:
          "Mantenimiento preventivo, limpieza, revisión y atención de sistemas de aire acondicionado.",
        cta: "Solicitar mantenimiento",
      },
      plumbing: {
        title: "Plomería",
        description:
          "Fugas, grifería, sanitarios, conexiones y reparaciones comunes.",
        cta: "Necesito un plomero",
      },
      painting: {
        title: "Pintura",
        description:
          "Pintura interior, exterior, retoques y renovación de espacios.",
        cta: "Cotizar pintura",
      },
      electrical: {
        title: "Electricidad",
        description:
          "Reparaciones e instalaciones eléctricas menores, luminarias, interruptores y tomacorrientes.",
        cta: "Solicitar servicio",
      },
      locksmith: {
        title: "Cerrajería",
        description:
          "Instalación, cambio y reparación de cerraduras y soluciones relacionadas.",
        cta: "Solicitar cerrajería",
      },
      repairs: {
        title: "Reparaciones generales",
        description:
          "Pequeñas reparaciones e instalaciones para mantener tu propiedad funcionando correctamente.",
        cta: "Tengo algo que reparar",
      },
      remodeling: {
        title: "Pequeñas remodelaciones",
        description:
          "Mejoras y adecuaciones de baños, cocinas, habitaciones, oficinas y otros espacios.",
        cta: "Quiero mejorar un espacio",
      },
    },
  },
  integrated: {
    title: "¿Varias cosas por reparar?",
    body: "No siempre necesitas contratar diferentes proveedores para cada pequeño trabajo. Cuéntanos qué necesita tu propiedad y coordinamos contigo la mejor forma de atenderlo.",
    items: [
      "Pintar",
      "Reparar una fuga",
      "Revisar el A/C",
      "Cambiar una cerradura",
    ],
    equals: "HOMESTEAD SERVICES",
    cta: "Cuéntanos qué necesitas",
  },
  ac: {
    title: "Mantenimiento de aire acondicionado",
    body: "Un servicio pensado para mantener tu sistema en buen estado y detectar a tiempo lo que conviene revisar.",
    items: [
      "Limpieza",
      "Revisión general",
      "Mantenimiento preventivo",
      "Diagnóstico",
      "Atención de problemas comunes",
    ],
    cta: "Solicitar mantenimiento de A/C",
  },
  process: {
    title: "Resolverlo debe ser fácil.",
    steps: [
      {
        number: "01",
        title: "Cuéntanos",
        body: "Explícanos qué necesitas y, si puedes, envíanos fotografías.",
      },
      {
        number: "02",
        title: "Coordinamos",
        body: "Revisamos tu solicitud y coordinamos contigo los siguientes pasos.",
      },
      {
        number: "03",
        title: "Atendemos",
        body: "Realizamos el servicio acordado.",
      },
      {
        number: "04",
        title: "Listo",
        body: "Revisamos contigo el trabajo realizado.",
      },
    ],
  },
  scheduled: {
    title: "Evita esperar a que algo falle.",
    body: "Podemos ayudarte a coordinar mantenimientos periódicos de tu propiedad según los servicios que necesites.",
    applies: "Aplicable a",
    items: [
      "Aire acondicionado",
      "Pintura",
      "Revisión de instalaciones",
      "Reparaciones",
      "Mantenimiento general",
    ],
    cta: "Consultar mantenimiento",
  },
  trust: {
    title: "Servicio claro desde el primer contacto.",
    items: [
      {
        title: "Comunicación clara",
        body: "Entender qué necesita el cliente antes de coordinar.",
      },
      {
        title: "Atención organizada",
        body: "Cada solicitud debe tener información suficiente para poder atenderla correctamente.",
      },
      {
        title: "Cuidado de la propiedad",
        body: "La experiencia debe transmitir respeto por el espacio del cliente.",
      },
      {
        title: "Soluciones prácticas",
        body: "Resolver necesidades reales sin complicar innecesariamente el servicio.",
      },
    ],
  },
  cta: {
    title: "Cuéntanos qué necesita tu espacio",
    body: "Puedes solicitar el servicio o escribirnos por WhatsApp. Coordinamos instalación, reparación o mantenimiento.",
    request: "Solicitar servicio",
    whatsapp: "Escribir por WhatsApp",
  },
  contact: {
    title: "Estamos para ayudarte",
    body: "Completa la solicitud o escríbenos. Mientras más claro nos cuentes el problema, mejor podemos coordinar.",
    whatsapp: "WhatsApp",
    phone: "Teléfono",
    email: "Email",
    hours: "Horario",
    area: "Zona de atención",
    pending: "Lo publicaremos aquí cuando esté confirmado.",
  },
  form: {
    title: "Solicitar servicio",
    body: "Describe lo que necesitas. Agrega fotografías cuando el servicio lo requiera o cuando ayuden a entender el problema.",
    name: "Nombre",
    phone: "Teléfono",
    email: "Email",
    property: "Tipo de propiedad",
    service: "Servicio",
    message: "¿Qué necesitas?",
    messagePlaceholder: "Describe el problema, el lugar y desde cuándo.",
    messageHelp: "Cuéntanos qué ocurre, en qué parte de la propiedad y desde cuándo.",
    messageExampleLabel: "Ejemplo",
    messageMinHint: "Mínimo 8 caracteres.",
    messageRemaining: "Faltan {n} caracteres.",
    upload: "Fotografías (opcional)",
    uploadRequired: "Fotografías requeridas",
    uploadHint: "JPEG, PNG o WEBP. Hasta 6 imágenes, máximo 5 MB cada una.",
    uploadOptionalHint: "Las fotos son opcionales para este servicio. JPEG, PNG o WEBP · hasta 6 · máx. 5 MB c/u.",
    removePhoto: "Quitar",
    locksmithIntent: "¿Qué necesitas en cerrajería?",
    reviewingPhotos: "Estamos revisando tus fotos de la puerta…",
    uploadingPhotos: "Subiendo fotos…",
    submit: "Solicitar servicio",
    sending: "Enviando solicitud…",
    slowSubmit: "Está tardando más de lo habitual. Estamos comprobando el envío.",
    uncertainSubmit:
      "No confirmamos la respuesta del servidor. Si reintentas, no se duplicará la solicitud.",
    formErrorBanner: "Revisa los campos señalados para enviar tu solicitud.",
    successTitle: "Tu solicitud quedó registrada",
    successBody: "Guardamos tu solicitud correctamente.",
    successFolio: "Folio",
    successCopyFolio: "Copiar folio",
    successCopied: "Folio copiado",
    successSummary: "Servicio",
    successNextStep: "Nuestro equipo revisará tu solicitud y te contactará para coordinar el siguiente paso.",
    successAnother: "Enviar otra solicitud",
    errorTitle: "No se pudo enviar",
    errorBody: "Inténtalo de nuevo. Tus datos permanecen en el formulario.",
    propertyOptions: {
      house: "Casa",
      apartment: "Apartamento",
      ph: "PH",
      office: "Oficina",
      commerce: "Comercio",
      other: "Otro",
    },
    serviceOptions: {
      ac: "Aire acondicionado",
      plumbing: "Plomería",
      painting: "Pintura",
      electrical: "Electricidad",
      locksmith: "Cerrajería",
      repairs: "Reparaciones",
      remodeling: "Remodelación",
      multiple: "Varios servicios",
      other: "Otro",
    },
    errors: {
      name: "Escribe tu nombre.",
      phone: "Escribe un teléfono de contacto.",
      email: "Escribe un email válido.",
      property: "Selecciona el tipo de propiedad.",
      service: "Selecciona un servicio.",
      message: "Cuéntanos un poco más sobre lo que necesitas.",
      messageQuality:
        "Necesitamos un poco más de información para ayudarte. Describe qué problema presenta y dónde ocurre.",
      files: "Usa imágenes JPEG, PNG o WEBP de hasta 5 MB. Máximo 6 fotografías.",
      intent: "Indica qué necesitas en cerrajería.",
      digitalLockPhotos: "Necesitamos las tres vistas de tu puerta para continuar.",
      digitalLockMissing: "Falta la foto de {slot}.",
    },
  },
  whatsapp: {
    label: "WhatsApp",
    defaultMessage: "Hola, quisiera información sobre los servicios de Homestead.",
    headerMessage: "Hola, quisiera información sobre los servicios de Homestead.",
    serviceMessage: "Hola, quisiera información sobre el servicio de {service} de Homestead.",
    floatLabel: "Contactar a Homestead por WhatsApp",
  },
  social: {
    follow: "Síguenos",
    soon: "Próximamente",
  },
  footer: {
    rights: "Todos los derechos reservados.",
    note: "Mantenimiento, reparaciones y mejoras para hogares, apartamentos, oficinas y pequeños comercios.",
  },
  notFound: {
    title: "No encontramos esta página",
    body: "Puedes volver al inicio o solicitar un servicio desde allí.",
    home: "Volver al inicio",
  },
};
