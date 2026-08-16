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
    upload: string;
    uploadHint: string;
    removePhoto: string;
    submit: string;
    sending: string;
    successTitle: string;
    successBody: string;
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
      files: string;
    };
  };
  whatsapp: {
    label: string;
    defaultMessage: string;
    serviceMessage: string;
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
    whatsapp: "Escríbenos por WhatsApp",
    call: "Llamar",
    representativeNote: "Imagen representativa del servicio",
    comingSoon: "Por confirmar",
  },
  hero: {
    title: "Tu espacio en buenas manos.",
    subtitle:
      "Mantenimiento, reparaciones y mejoras para tu hogar, apartamento, oficina o negocio.",
    chips:
      "Aire acondicionado • Plomería • Pintura • Electricidad • Cerrajería • Reparaciones",
  },
  services: {
    title: "¿Qué necesitas resolver?",
    intro:
      "Cuéntanos el problema. Te ayudamos a coordinar el siguiente paso con claridad y cuidado por tu espacio.",
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
    title: "¿Qué necesitas reparar?",
    body: "Cuéntanos el problema. Nosotros te ayudamos con el siguiente paso.",
    request: "Solicitar servicio",
    whatsapp: "Hablar por WhatsApp",
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
    body: "Describe lo que necesitas. Si puedes, agrega fotografías del espacio o del problema.",
    name: "Nombre",
    phone: "Teléfono",
    email: "Email",
    property: "Tipo de propiedad",
    service: "Servicio",
    message: "¿Qué necesitas?",
    messagePlaceholder: "Cuéntanos el problema, el espacio y cualquier detalle útil.",
    upload: "Agregar fotografías",
    uploadHint: "Hasta 6 imágenes, 5 MB cada una.",
    removePhoto: "Quitar",
    submit: "Solicitar servicio",
    sending: "Enviando",
    successTitle: "Solicitud recibida",
    successBody: "Gracias. Hemos recibido la información de tu servicio.",
    successAnother: "Enviar otra solicitud",
    errorTitle: "No se pudo enviar",
    errorBody: "Inténtalo de nuevo en un momento. Si el problema continúa, escríbenos por WhatsApp.",
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
      files: "Usa imágenes de hasta 5 MB. Máximo 6 fotografías.",
    },
  },
  whatsapp: {
    label: "WhatsApp",
    defaultMessage: "Hola Homestead Services. Necesito ayuda.",
    serviceMessage: "Hola Homestead Services. Necesito ayuda con {service}.",
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
