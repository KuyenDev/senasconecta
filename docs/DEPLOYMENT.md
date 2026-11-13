# Guía de publicación automatizada en GitHub Pages

El proyecto cuenta con dos capas de automatización para publicar en **GitHub Pages**:

1. **Workflow de GitHub Actions** ([`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)): cada vez que llega un cambio a `main` en `frontend/**`, `datos/**` o `scripts/importar_excel.py`, GitHub Actions ejecuta `python3 scripts/importar_excel.py` y despliega `frontend/` en GitHub Pages.
2. **Script todo-en-uno local** ([`scripts/publicar.py`](../scripts/publicar.py)): ejecuta todo el ciclo desde un solo comando en tu terminal usando la sesión Git guardada en tu equipo (`git credential`).

---

## Cómo publicar o actualizar con un comando

Después de actualizar cualquier archivo en `datos/` o hacer ajustes al sitio:

```bash
python3 scripts/publicar.py
```

Opciones útiles:
- Reemplazar desde cero los registros previos usando solo lo que haya ahora en `datos/`:
  ```bash
  python3 scripts/publicar.py --replace
  ```
- Indicar un mensaje de commit personalizado:
  ```bash
  python3 scripts/publicar.py --mensaje "Actualizar registros de marzo"
  ```
- Subir a otro nombre de repositorio:
  ```bash
  python3 scripts/publicar.py --repo mi-otro-repo
  ```

---

## Nota sobre visibilidad en GitHub gratuito

En cuentas personales de GitHub en plan gratuito (`free`), **GitHub Pages solo está disponible para repositorios públicos**.

Si en el futuro decides subir datos sensibles de personas en `frontend/data/personas.json` o `datos/`, recuerda que tanto el sitio en GitHub Pages como el repositorio público serán accesibles mediante su enlace.
