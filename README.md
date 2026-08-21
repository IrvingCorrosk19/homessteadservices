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

Completa `.env.local` a partir de `.env.example`. No inventes teléfono ni WhatsApp.

El correo de solicitudes es `servicios@homestead.lat`. Las peticiones del formulario se envían a esa cuenta.

```
NEXT_PUBLIC_PHONE=
NEXT_PUBLIC_EMAIL=servicios@homestead.lat
NEXT_PUBLIC_WHATSAPP=
NEXT_PUBLIC_HOURS=8:00 a.m. a 10:00 p.m.
NEXT_PUBLIC_SERVICE_AREA=Todo Panamá
```

`NEXT_PUBLIC_WHATSAPP` debe ir en formato internacional, solo dígitos. Ejemplo: `50760000000`.

Mientras esos valores estén vacíos, la página no muestra datos inventados y los botones de llamada/WhatsApp redirigen al formulario.

Las notificaciones internas de n8n/Telegram se documentan en [docs/HOMESTEAD-N8N-TELEGRAM.md](docs/HOMESTEAD-N8N-TELEGRAM.md).

El panel privado de solicitudes está en `/admin/solicitudes`. No es público: exige clave de administrador en el servidor (`ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`).

Content Studio (fotos de trabajos → copy, sin publicar en redes) se documenta en [docs/HOMESTEAD-CONTENT-STUDIO.md](docs/HOMESTEAD-CONTENT-STUDIO.md).

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
