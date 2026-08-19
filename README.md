# HOMESTEAD SERVICES

Sitio web de **Repairs • Maintenance • Improvements**.

## Desarrollo

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Producción

- https://homestead.lat/
- Vista previa: http://164.68.99.83:8094/

## Configuración de contacto

Completa `.env.local` a partir de `.env.example`. No inventes teléfono, WhatsApp, email, horario ni zona de atención.

```
NEXT_PUBLIC_PHONE=
NEXT_PUBLIC_EMAIL=
NEXT_PUBLIC_WHATSAPP=
NEXT_PUBLIC_HOURS=
NEXT_PUBLIC_SERVICE_AREA=
```

`NEXT_PUBLIC_WHATSAPP` debe ir en formato internacional, solo dígitos. Ejemplo: `50760000000`.

Mientras esos valores estén vacíos, la página no muestra datos inventados y los botones de llamada/WhatsApp redirigen al formulario.

## Imágenes

Las fotografías actuales son **representativas del servicio**, no trabajos de HOMESTEAD.

Para reemplazarlas por fotos reales, usa los mismos nombres en `public/images/`:

- `hero.webp`
- `cta.webp`
- `contact.webp`
- `features/ac-maintenance.webp`
- `services/ac.webp`
- `services/plumbing.webp`
- `services/painting.webp`
- `services/electrical.webp`
- `services/locksmith.webp`
- `services/repairs.webp`
- `services/remodeling.webp`

Cuando existan fotografías auténticas de proyectos, activa `works.enabled` en `src/data/images.ts`.
Cuando existan testimonios reales, activa `testimonials.enabled`.
