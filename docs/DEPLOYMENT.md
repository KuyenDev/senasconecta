# Guía de publicación en GitHub Pages

El proyecto queda listo para desplegarse como sitio estático gratuito en **GitHub Pages** mediante el flujo incluido en `.github/workflows/deploy-pages.yml`.

---

## 1. Conectar el repositorio remoto en GitHub

Si todavía no has enlazado este proyecto con tu repositorio en GitHub:

1. Crea un repositorio nuevo en GitHub (por ejemplo `senasconecta`).
   - Recomendación: si vas a guardar datos personales en `frontend/data/` y planillas en `datos_excel/`, utiliza un **repositorio privado** (en cuentas con GitHub Pro/Team/Enterprise si usas Pages privado, o evalúa antes qué información publicas en GitHub Pages público).
2. Enlaza el remoto local y sube la rama `main`:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

---

## 2. Activar GitHub Pages una sola vez

1. En GitHub, abre tu repositorio y entra a **Settings → Pages**.
2. En **Build and deployment → Source**, elige **GitHub Actions**.
3. En la pestaña **Actions** del repositorio verás ejecutarse el workflow **"Desplegar SeñasConecta en GitHub Pages"** (o puedes lanzarlo manualmente con **Run workflow**).
4. Al terminar, GitHub mostrará la URL pública del sitio (por ejemplo `https://TU_USUARIO.github.io/TU_REPOSITORIO/`).

---

## 3. Cómo publicar futuras actualizaciones desde Excel

Cada vez que actualices las planillas en `datos_excel/`:

```bash
python3 scripts/importar_excel.py
git add datos_excel frontend/data
git commit -m "Actualizar registros territoriales"
git push origin main
```

Al detectar cambios dentro de `frontend/**`, GitHub Actions volverá a publicar la página automáticamente en menos de un minuto.
