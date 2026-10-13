/*
 * Buscador de Series - Consumo de la API pública de TVMaze + Favoritos persistentes
 * --------------------------------------------------------------------------------
 * Flujo general:
 *   1. El usuario envía el formulario (botón "Buscar" o tecla Enter).
 *   2. buscarSeries() consulta la API con fetch + async/await.
 *   3. Mientras espera, se muestra el estado de CARGA.
 *   4. Si hay éxito, se renderiza el resultado DESTACADO y la GRILLA.
 *   5. Si hay error (fallo de red, 404/500 o sin resultados), se muestra la ALERTA.
 *
 * Favoritos (LocalStorage):
 *   - Cada resultado tiene un botón "Guardar" que alterna su presencia en la lista.
 *   - Los datos se persisten con localStorage.setItem() + JSON.stringify().
 *   - El panel "Mi lista" los lee con JSON.parse() y se pinta en DOMContentLoaded.
 *   - Permite eliminar elementos individuales o vaciar toda la lista.
 *
 * API: https://www.tvmaze.com/api  (pública, no requiere API key)
 *
 * --------------------------------------------------------------------------------
 * ÍNDICE RÁPIDO DE FUNCIONES PRINCIPALES
 * --------------------------------------------------------------------------------
 * BÚSQUEDA Y RENDER
 *   buscarSeries()         - Pide a la API y maneja los estados carga/éxito/error.
 *   renderizarResultados() - Separa el destacado (1º) del resto y pinta todo.
 *   renderizarDestacada()  - Arma la tarjeta grande "En primer plano".
 *   renderizarGrilla()     - Pinta la cuadrícula de pósters.
 *   crearTarjeta()         - Crea una tarjeta-póster individual.
 *   generoPills()          - Crea las etiquetas (badges) de géneros.
 *
 * SELECCIÓN
 *   seleccionarDestacada() - Muestra una serie de la Cartelera en primer plano.
 *   seleccionarFavorito()  - Muestra un favorito de "Mi lista" en primer plano.
 *   resaltarTarjetaPorId() - Resalta en la grilla la tarjeta seleccionada.
 *   marcarTarjeta()        - Aplica/quita las clases de "seleccionado".
 *
 * FAVORITOS (LocalStorage)
 *   leerFavoritos()        - getItem + JSON.parse (con normalización).
 *   guardarFavoritos()     - setItem + JSON.stringify.
 *   normalizarFavorito()   - Da "forma de show" y migra datos antiguos.
 *   resumenShow()          - Extrae la ficha de la serie a guardar.
 *   esFavorito()           - ¿La serie ya está guardada?
 *   alternarFavorito()     - Guarda o quita y refresca la UI.
 *   eliminarFavorito()     - Borra uno y actualiza storage + UI.
 *   crearBotonGuardar*()   - Botones "Guardar" (de texto y de icono).
 *   actualizarEstadoBoton()- Pinta el botón según su estado (guardado o no).
 *   sincronizarBotones()   - Re-sincroniza los botones tras un cambio.
 *   renderizarFavoritos()  - Pinta el panel "Mi lista".
 *   crearItemFavorito()    - Crea una fila del panel con su botón borrar.
 *   abrirDrawer()/cerrarDrawer() - Abren/cierran el panel lateral.
 *
 * UTILIDADES
 *   el()                    - Atajo para crear elementos (textContent, seguro ante XSS).
 *   imagen()                - Mejor URL de imagen disponible (prefiere "original").
 *   notaTexto()             - Formatea la calificación ("N/D" si no hay).
 *   limpiarHTML()           - Convierte el HTML del resumen en texto plano.
 *   mostrarError()/ocultarRespuestas() - Controlan la visibilidad de secciones.
 */

// ===== Referencias a elementos del DOM =====
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const featuredSection = document.getElementById('featured');
const featuredCard = document.getElementById('featuredCard');
const resultsHeader = document.getElementById('resultsHeader');
const resultsCount = document.getElementById('resultsCount');
const resultsGrid = document.getElementById('resultsGrid');

// Elementos del sistema de favoritos
const btnFavoritos = document.getElementById('btnFavoritos');
const favoritosCount = document.getElementById('favoritosCount');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const btnCerrarDrawer = document.getElementById('btnCerrarDrawer');
const btnVaciar = document.getElementById('btnVaciar');
const favoritosList = document.getElementById('favoritosList');
const favoritosVacio = document.getElementById('favoritosVacio');
const storageUso = document.getElementById('storageUso');
const storageBar = document.getElementById('storageBar');
const storageDetalle = document.getElementById('storageDetalle');

// ===== Constantes de configuración =====
const API_URL = 'https://api.tvmaze.com/search/shows?q=';
const PLACEHOLDER = 'https://placehold.co/800x1200/121218/475569?text=Sin+imagen';
const FAV_KEY = 'cinematografia.favoritos';
const STORAGE_QUOTA = 5 * 1024 * 1024; // Cuota aproximada de LocalStorage por origen (5 MB)

// Clases de Tailwind para los botones "Guardar" según su estado
const BTN_TEXTO_BASE = 'inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border transition';
const BTN_TEXTO_ACTIVO = `${BTN_TEXTO_BASE} bg-amber-400 text-black border-amber-400 hover:bg-amber-300`;
const BTN_TEXTO_INACTIVO = `${BTN_TEXTO_BASE} border-white/15 text-white hover:bg-white/10 hover:border-amber-400/40`;

const BTN_ICONO_BASE = 'absolute top-3 left-3 z-10 w-9 h-9 rounded-full backdrop-blur border flex items-center justify-center transition text-sm font-bold';
const BTN_ICONO_ACTIVO = `${BTN_ICONO_BASE} bg-amber-400 text-black border-amber-400`;
const BTN_ICONO_INACTIVO = `${BTN_ICONO_BASE} bg-black/70 text-amber-300 border-amber-400/30 hover:bg-black/90`;

// Clases que resaltan la tarjeta actualmente mostrada "En primer plano"
const CARD_SELECCIONADA = ['ring-2', 'ring-amber-400', 'shadow-2xl', 'shadow-amber-400/20', '-translate-y-2'];

/**
 * Manejador del envío del formulario de búsqueda.
 * Evita la recarga de la página, valida que haya texto y lanza la búsqueda.
 */
searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) {
        ocultarRespuestas();
        mostrarError('Escribe el nombre de una serie para empezar.');
        return;
    }
    buscarSeries(query);
});

/**
 * Consulta la API de TVMaze y gestiona los tres estados de la interfaz.
 * @param {string} query - Término de búsqueda escrito por el usuario.
 * @returns {Promise<void>}
 */
async function buscarSeries(query) {
    // Estado de CARGA: limpiar resultados previos y mostrar el spinner.
    ocultarRespuestas();
    loading.classList.remove('hidden');

    try {
        const response = await fetch(`${API_URL}${encodeURIComponent(query)}`);

        // Validación HTTP: 404, 500, etc. (response.ok es true solo para 200-299).
        if (!response.ok) {
            throw new Error(`Error en el servidor: Estado ${response.status}`);
        }

        const data = await response.json();

        // TVMaze responde 200 con un arreglo vacío cuando no hay coincidencias.
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error(`No encontramos series para "${query}". Prueba con otro título.`);
        }

        // Estado de ÉXITO: pintar los resultados en el DOM.
        renderizarResultados(data);
    } catch (error) {
        // Estado de ERROR: cualquier fallo (red, HTTP o sin resultados) llega aquí.
        console.error('Error al consumir la API:', error);
        mostrarError(error.message);
    } finally {
        // Siempre se oculta el spinner, haya éxito o error.
        loading.classList.add('hidden');
    }
}

/**
 * Separa los resultados en un "destacado" (el primero) y el resto (grilla).
 * @param {Array<Object>} data - Arreglo de objetos { score, show } que devuelve la API.
 */
function renderizarResultados(data) {
    const shows = data.map((item) => item.show);
    const [destacada, ...resto] = shows;

    renderizarDestacada(destacada);
    renderizarGrilla(resto);

    // Contador de resultados con plural correcto.
    resultsCount.textContent = `${data.length} resultado${data.length === 1 ? '' : 's'}`;
    resultsHeader.classList.remove('hidden');
}

/**
 * Construye la tarjeta grande "En primer plano" con el resultado principal.
 * @param {Object} show - Objeto de serie de TVMaze.
 */
function renderizarDestacada(show) {
    featuredCard.innerHTML = '';

    // Capa de vidrio aislada: el backdrop-blur no debe afectar al póster (lo suavizaría).
    const glass = el('div', 'absolute inset-0 -z-10 rounded-3xl bg-white/[0.03] backdrop-blur-xl');
    featuredCard.append(glass);

    // Póster en alta resolución.
    const posterWrap = el('div', 'relative overflow-hidden rounded-2xl');
    const img = el('img',
        'w-full h-full min-h-[340px] max-h-[540px] object-cover bg-slate-800 transform-gpu backface-hidden transition-transform duration-700 ease-out group-hover:scale-105');
    img.src = imagen(show);
    img.alt = `Póster de ${show.name}`;
    img.decoding = 'async';
    img.setAttribute('fetchpriority', 'high');
    posterWrap.append(img);

    // Insignia de calificación (estrella).
    const rating = el('div',
        'absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur border border-amber-400/30 text-amber-300 text-sm font-semibold');
    rating.append(el('span', '', '★'), el('span', '', notaTexto(show)));
    posterWrap.append(rating);

    // Columna de información textual.
    const info = el('div', 'flex flex-col justify-center gap-4 py-2 pr-1');
    info.append(el('span', 'self-start text-xs uppercase tracking-[0.25em] text-amber-400', show.status || 'Estado desconocido'));
    info.append(el('h2', 'font-display text-4xl sm:text-6xl leading-none text-white', show.name));

    // Metadatos: año de estreno, idioma y cadena/plataforma.
    const metaBits = [];
    if (show.premiered) metaBits.push(show.premiered.slice(0, 4));
    if (show.language) metaBits.push(show.language);
    const cadena = (show.network && show.network.name) || (show.webChannel && show.webChannel.name);
    if (cadena) metaBits.push(cadena);
    if (metaBits.length) {
        info.append(el('p', 'text-sm text-slate-400', metaBits.join('  ·  ')));
    }

    info.append(generoPills(show.genres));
    info.append(el('p', 'text-slate-300/90 leading-relaxed max-w-2xl',
        limpiarHTML(show.summary) || 'Sin descripción disponible.'));

    // Acciones: botón Guardar + enlace opcional al sitio oficial.
    const acciones = el('div', 'flex flex-wrap items-center gap-3 mt-1');
    acciones.append(crearBotonGuardarTexto(show));
    if (show.officialSite) {
        const link = el('a',
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/15 text-sm font-medium text-white hover:bg-white/10 hover:border-amber-400/40 transition',
            'Sitio oficial ↗');
        link.href = show.officialSite;
        link.target = '_blank';
        link.rel = 'noopener';
        acciones.append(link);
    }
    info.append(acciones);

    featuredCard.append(posterWrap, info);
    featuredSection.classList.remove('hidden');
}

/**
 * Renderiza la cuadrícula de pósters con el resto de resultados.
 * @param {Array<Object>} shows - Series (sin incluir el destacado).
 */
function renderizarGrilla(shows) {
    resultsGrid.innerHTML = '';

    // Si solo hubo un resultado, no hay grilla que mostrar.
    if (!shows.length) {
        resultsGrid.classList.add('hidden');
        return;
    }

    // Animación escalonada: cada tarjeta entra con un pequeño retardo.
    shows.forEach((show, index) => {
        const card = crearTarjeta(show);
        card.style.animationDelay = `${Math.min(index * 60, 600)}ms`;
        resultsGrid.append(card);
    });

    resultsGrid.classList.remove('hidden');
}

/**
 * Crea el elemento <article> de una tarjeta-póster individual.
 * @param {Object} show - Objeto de serie de TVMaze.
 * @returns {HTMLElement} Nodo listo para insertar en la grilla.
 */
function crearTarjeta(show) {
    const card = el('article',
        'group relative aspect-[2/3] rounded-2xl overflow-hidden border border-white/10 bg-slate-900 cursor-pointer transition-all duration-500 hover:-translate-y-2 hover:border-amber-400/40 hover:shadow-2xl hover:shadow-amber-400/10 animate-fade-up');
    card.dataset.showId = show.id;

    // Póster de fondo (alta resolución + GPU para que el zoom no lo pixele).
    const img = el('img',
        'absolute inset-0 w-full h-full object-cover bg-slate-800 transform-gpu backface-hidden transition-transform duration-700 ease-out group-hover:scale-110');
    img.src = imagen(show);
    img.alt = `Póster de ${show.name}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // Degradado inferior para garantizar legibilidad del texto.
    const overlay = el('div',
        'absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent opacity-90 group-hover:opacity-100 transition-opacity duration-500');

    // Insignia de calificación.
    const rating = el('div',
        'absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur border border-amber-400/30 text-amber-300 text-xs font-bold',
        `★ ${notaTexto(show)}`);

    // Texto inferior: título, géneros y año.
    const content = el('div',
        'absolute inset-x-0 bottom-0 p-4 flex flex-col gap-1.5 translate-y-2 group-hover:translate-y-0 transition-transform duration-500');
    content.append(el('h3', 'font-display text-2xl leading-none text-white', show.name));

    const generos = (show.genres && show.genres.length)
        ? show.genres.slice(0, 3).join(' · ')
        : 'Sin clasificar';
    content.append(el('p', 'text-xs text-slate-300/80', generos));

    if (show.premiered) {
        content.append(el('p', 'text-xs text-slate-500', show.premiered.slice(0, 4)));
    }

    // Enlace que cubre toda la tarjeta: al hacer clic, muestra esta serie
    // en la sección "En primer plano" y la resalta como seleccionada.
    // Se apila (z-[5]) por debajo del botón Guardar (z-10) para no bloquearlo.
    const link = el('a', 'absolute inset-0 z-[5] focus:outline-none', '');
    link.href = '#featured';
    link.setAttribute('aria-label', `Mostrar ${show.name} en primer plano`);
    link.addEventListener('click', (event) => {
        event.preventDefault();
        seleccionarDestacada(show);
    });

    card.append(img, overlay, rating, content, crearBotonGuardarIcono(show), link);
    return card;
}

/**
 * Muestra la serie elegida en la sección "En primer plano" y resalta su tarjeta.
 * Se dispara al hacer clic en una tarjeta de la Cartelera.
 * @param {Object} show - Serie seleccionada.
 */
function seleccionarDestacada(show) {
    renderizarDestacada(show);
    resaltarTarjetaPorId(show.id);

    // Llevar la vista hasta el destacado.
    featuredSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Muestra en "En primer plano" una serie guardada en Mi lista.
 * No consulta la API: los favoritos guardan la ficha completa de la serie.
 * @param {Object} fav - Favorito seleccionado.
 */
function seleccionarFavorito(fav) {
    cerrarDrawer();
    renderizarDestacada(fav);
    resaltarTarjetaPorId(fav.id);
    featuredSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Resalta en la grilla la tarjeta cuyo id coincide y quita el resaltado del resto.
 * @param {number} id
 */
function resaltarTarjetaPorId(id) {
    resultsGrid.querySelectorAll('article').forEach((tarjeta) => {
        marcarTarjeta(tarjeta, Number(tarjeta.dataset.showId) === id);
    });
}

/**
 * Aplica o quita las clases de "seleccionado" a una tarjeta.
 * @param {HTMLElement} card
 * @param {boolean} activo
 */
function marcarTarjeta(card, activo) {
    CARD_SELECCIONADA.forEach((clase) => card.classList.toggle(clase, activo));
}

/**
 * Crea las "píldoras" (badges) con los géneros de una serie.
 * @param {string[]} genres - Arreglo de géneros.
 * @returns {HTMLElement} Contenedor con las etiquetas.
 */
function generoPills(genres) {
    const wrap = el('div', 'flex flex-wrap gap-2');

    if (!genres || !genres.length) {
        wrap.append(el('span',
            'px-3 py-1 rounded-full text-xs bg-white/5 border border-white/10 text-slate-400', 'Sin clasificar'));
        return wrap;
    }

    genres.forEach((genero) => {
        wrap.append(el('span',
            'px-3 py-1 rounded-full text-xs font-medium bg-amber-400/10 border border-amber-400/20 text-amber-300',
            genero));
    });

    return wrap;
}

// ===================================================================
// SISTEMA DE FAVORITOS (LocalStorage)
// ===================================================================

/**
 * Lee la lista de favoritos desde LocalStorage.
 * @returns {Array<Object>} Arreglo de favoritos (vacío si no hay o está corrupto).
 */
function leerFavoritos() {
    try {
        const raw = localStorage.getItem(FAV_KEY);
        const lista = raw ? JSON.parse(raw) : [];
        return Array.isArray(lista) ? lista.map(normalizarFavorito) : [];
    } catch (error) {
        console.error('No se pudieron leer los favoritos:', error);
        return [];
    }
}

/**
 * Guarda la lista completa de favoritos en LocalStorage.
 * @param {Array<Object>} lista
 */
function guardarFavoritos(lista) {
    try {
        localStorage.setItem(FAV_KEY, JSON.stringify(lista));
    } catch (error) {
        console.error('No se pudieron guardar los favoritos:', error);
    }
}

/**
 * Normaliza un favorito a un objeto con "forma de show" de TVMaze.
 * También migra datos antiguos (imagen y nota guardadas como valores simples).
 * @param {Object} fav
 * @returns {Object}
 */
function normalizarFavorito(fav) {
    return {
        id: fav.id,
        name: fav.name || 'Sin título',
        url: fav.url || '',
        image: typeof fav.image === 'string'
            ? { medium: fav.image, original: fav.image }
            : (fav.image || null),
        rating: typeof fav.rating === 'number'
            ? { average: fav.rating }
            : (fav.rating || { average: null }),
        premiered: fav.premiered || '',
        status: fav.status || '',
        language: fav.language || '',
        genres: Array.isArray(fav.genres) ? fav.genres : [],
        summary: fav.summary || '',
        network: fav.network || null,
        webChannel: fav.webChannel || null,
        officialSite: fav.officialSite || null,
    };
}

/**
 * Extrae la ficha de una serie para almacenarla como favorito (datos esenciales + de presentación).
 * @param {Object} show
 * @returns {Object}
 */
function resumenShow(show) {
    return normalizarFavorito({
        id: show.id,
        name: show.name,
        url: show.url,
        image: show.image,
        rating: show.rating,
        premiered: show.premiered,
        status: show.status,
        language: show.language,
        genres: show.genres,
        summary: show.summary,
        network: show.network,
        webChannel: show.webChannel,
        officialSite: show.officialSite,
    });
}

/**
 * Indica si una serie ya está guardada.
 * @param {number} id
 * @returns {boolean}
 */
function esFavorito(id) {
    return leerFavoritos().some((fav) => fav.id === id);
}

/**
 * Agrega o quita una serie de la lista y refresca la UI.
 * @param {Object} show
 * @param {HTMLElement} boton - Botón presionado (para actualizar su estado).
 */
function alternarFavorito(show, boton) {
    const lista = leerFavoritos();
    const indice = lista.findIndex((fav) => fav.id === show.id);

    if (indice >= 0) {
        lista.splice(indice, 1);
    } else {
        lista.unshift(resumenShow(show));
    }

    guardarFavoritos(lista);

    const ahoraFavorito = esFavorito(show.id);
    actualizarEstadoBoton(boton, ahoraFavorito);

    // Feedback "wow": la portada vuela hasta "Mi lista" y aparece un aviso flotante.
    if (ahoraFavorito) animarGuardado(boton);
    mostrarToast(ahoraFavorito ? 'add' : 'remove', show);

    renderizarFavoritos();
}

/**
 * Elimina un favorito por su id y actualiza LocalStorage y la UI.
 * @param {number} id
 */
function eliminarFavorito(id) {
    const lista = leerFavoritos().filter((fav) => fav.id !== id);
    guardarFavoritos(lista);
    renderizarFavoritos();
    sincronizarBotones();
}

/**
 * Crea el botón "Guardar" con texto para el resultado destacado.
 * @param {Object} show
 * @returns {HTMLElement}
 */
function crearBotonGuardarTexto(show) {
    const boton = el('button', '', '');
    boton.type = 'button';
    boton.dataset.favId = show.id;
    boton.dataset.favTipo = 'texto';
    boton.addEventListener('click', () => alternarFavorito(show, boton));
    actualizarEstadoBoton(boton, esFavorito(show.id));
    return boton;
}

/**
 * Crea el botón "Guardar" compacto (icono) para las tarjetas de la grilla.
 * @param {Object} show
 * @returns {HTMLElement}
 */
function crearBotonGuardarIcono(show) {
    const boton = el('button', '', '');
    boton.type = 'button';
    boton.title = 'Guardar en Mi lista';
    boton.dataset.favId = show.id;
    boton.dataset.favTipo = 'icono';
    boton.addEventListener('click', (event) => {
        event.stopPropagation();
        alternarFavorito(show, boton);
    });
    actualizarEstadoBoton(boton, esFavorito(show.id));
    return boton;
}

/**
 * Aplica el aspecto visual correcto al botón según si el show está guardado.
 * @param {HTMLElement} boton
 * @param {boolean} activo
 */
function actualizarEstadoBoton(boton, activo) {
    if (boton.dataset.favTipo === 'icono') {
        boton.className = activo ? BTN_ICONO_ACTIVO : BTN_ICONO_INACTIVO;
        boton.textContent = activo ? '✓' : '★';
    } else {
        boton.className = activo ? BTN_TEXTO_ACTIVO : BTN_TEXTO_INACTIVO;
        boton.textContent = activo ? '✓ Guardado' : '＋ Guardar';
    }
}

/**
 * Revisa todos los botones "Guardar" del DOM y los pone al día
 * (se usa tras eliminar desde el panel).
 */
function sincronizarBotones() {
    document.querySelectorAll('[data-fav-id]').forEach((boton) => {
        const id = Number(boton.dataset.favId);
        actualizarEstadoBoton(boton, esFavorito(id));
    });
}

/**
 * Reinicia y dispara la animación "pop" (escala) sobre un elemento.
 * @param {HTMLElement} nodo
 */
function popBoton(nodo) {
    nodo.classList.remove('animate-pop');
    void nodo.offsetWidth; // fuerza reflujo para reiniciar la animación
    nodo.classList.add('animate-pop');
}

/**
 * Efecto "vuelo": clona la portada de la serie y la anima hasta el botón "Mi lista".
 * @param {HTMLElement} boton - Botón Guardar presionado.
 */
function animarGuardado(boton) {
    const tarjeta = boton.closest('article');
    const origen = tarjeta ? tarjeta.querySelector('img') : null;
    const desde = (origen || boton).getBoundingClientRect();
    const hasta = btnFavoritos.getBoundingClientRect();

    const volador = document.createElement(origen ? 'img' : 'div');
    if (origen) {
        volador.src = origen.src;
        volador.alt = '';
    } else {
        volador.textContent = '★';
    }
    volador.className = 'fixed z-[80] rounded-lg object-cover pointer-events-none ring-2 ring-amber-400/70 shadow-2xl shadow-amber-400/40';

    const anchoInicial = Math.min(Math.max(desde.width, 44), 140);
    const altoInicial = anchoInicial * (desde.height / (desde.width || 1) || 1.4);

    volador.style.left = desde.left + 'px';
    volador.style.top = desde.top + 'px';
    volador.style.width = anchoInicial + 'px';
    volador.style.height = altoInicial + 'px';
    volador.style.transition = 'all .8s cubic-bezier(.5,-0.2,.3,1.3)';
    document.body.append(volador);

    requestAnimationFrame(() => {
        const destino = 24;
        volador.style.left = (hasta.left + hasta.width / 2 - destino / 2) + 'px';
        volador.style.top = (hasta.top + hasta.height / 2 - destino / 2) + 'px';
        volador.style.width = destino + 'px';
        volador.style.height = destino + 'px';
        volador.style.opacity = '0.15';
        volador.style.transform = 'rotate(40deg)';
    });

    setTimeout(() => volador.remove(), 850);
    popBoton(btnFavoritos);
}

/**
 * Muestra un aviso flotante ("Añadido/Quitado de Mi lista") con la miniatura.
 * @param {'add'|'remove'} accion
 * @param {Object} show
 */
function mostrarToast(accion, show) {
    const esAdd = accion === 'add';

    const toast = el('div',
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#0b0b12]/95 backdrop-blur-xl border border-amber-400/30 shadow-2xl shadow-black/60 animate-toast-in');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const img = el('img', 'w-10 h-14 object-cover rounded-lg bg-slate-800');
    img.src = imagen(show);
    img.alt = '';

    const texto = el('div', 'pr-2');
    texto.append(el('p',
        'text-[11px] uppercase tracking-[0.2em] ' + (esAdd ? 'text-amber-400' : 'text-slate-400'),
        esAdd ? '★ Añadido a Mi lista' : 'Quitado de Mi lista'));
    texto.append(el('p', 'font-display text-lg leading-none text-white', show.name));

    toast.append(img, texto);
    document.body.append(toast);

    setTimeout(() => {
        toast.style.animation = 'none'; // evita conflicto con la animación de entrada
        toast.style.transition = 'opacity .4s ease, transform .4s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, 16px)';
        setTimeout(() => toast.remove(), 400);
    }, 2200);
}

// ===== Indicador de memoria usada por LocalStorage =====

/**
 * Calcula los bytes que ocupa actualmente LocalStorage (todas las claves del origen).
 * @returns {number} Bytes usados.
 */
function bytesDeStorage() {
    let total = 0;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const clave = localStorage.key(i);
            const valor = localStorage.getItem(clave) || '';
            total += new Blob([clave, valor]).size;
        }
    } catch (error) {
        console.warn('No se pudo calcular el uso de LocalStorage:', error);
    }
    return total;
}

/**
 * Formatea una cantidad de bytes a un texto legible (B / KB / MB).
 * @param {number} bytes
 * @returns {string}
 */
function formatearBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Actualiza el indicador visual de memoria usada por LocalStorage.
 */
function actualizarIndicadorStorage() {
    const bytes = bytesDeStorage();
    const porcentaje = Math.min(100, (bytes / STORAGE_QUOTA) * 100);
    const elementos = leerFavoritos().length;

    storageUso.textContent = formatearBytes(bytes);

    const base = 'h-full rounded-full transition-all duration-700 ease-out ';
    storageBar.className = base + (porcentaje >= 80
        ? 'bg-gradient-to-r from-red-500 to-orange-500'
        : 'bg-gradient-to-r from-amber-400 to-orange-500');
    storageBar.style.width = `${Math.max(porcentaje, bytes > 0 ? 2 : 0)}%`;

    storageDetalle.textContent =
        `${elementos} elemento${elementos === 1 ? '' : 's'} · ${formatearBytes(STORAGE_QUOTA)} disponibles`;
}

// Guarda el último total para animar el contador solo cuando cambia.
let contadorPrevio = null;

/**
 * Dibuja el panel "Mi lista" leyendo LocalStorage y actualiza el contador.
 */
function renderizarFavoritos() {
    const lista = leerFavoritos();
    const total = lista.length;
    favoritosCount.textContent = total;

    // "Pop" del contador cuando cambia la cantidad.
    if (contadorPrevio !== null && total !== contadorPrevio) popBoton(favoritosCount);
    contadorPrevio = total;

    actualizarIndicadorStorage();

    favoritosList.innerHTML = '';

    // Estado vacío.
    if (!lista.length) {
        favoritosList.classList.add('hidden');
        favoritosVacio.classList.remove('hidden');
        favoritosVacio.classList.add('flex');
        return;
    }

    favoritosVacio.classList.add('hidden');
    favoritosVacio.classList.remove('flex');
    favoritosList.classList.remove('hidden');

    lista.forEach((fav, index) => favoritosList.append(crearItemFavorito(fav, index)));
}

/**
 * Crea la fila de un favorito dentro del panel, con su botón de borrado.
 * @param {Object} fav
 * @returns {HTMLElement}
 */
function crearItemFavorito(fav, index = 0) {
    const item = el('article',
        'group relative flex gap-3 items-center rounded-xl border border-white/10 bg-white/[0.03] p-2.5 cursor-pointer transition-all duration-300 hover:border-amber-400/40 hover:bg-white/[0.06] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-amber-400/10 animate-slide-in');
    item.style.animationDelay = `${Math.min(index * 55, 500)}ms`;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Mostrar ${fav.name} en primer plano`);

    const img = el('img', 'w-14 h-20 object-cover rounded-lg bg-slate-800 transition-transform duration-500 group-hover:scale-105');
    img.src = imagen(fav);
    img.alt = `Póster de ${fav.name}`;
    img.loading = 'lazy';

    const info = el('div', 'flex-1 min-w-0');
    info.append(el('h3', 'font-display text-lg leading-none text-white truncate', fav.name));

    const meta = [];
    const nota = notaTexto(fav);
    if (nota !== 'N/D') meta.push(`★ ${nota}`);
    if (fav.premiered) meta.push(fav.premiered.slice(0, 4));
    info.append(el('p', 'text-xs text-slate-400 mt-1', meta.join(' · ') || 'Sin datos'));

    const btnEliminar = el('button',
        'shrink-0 w-9 h-9 rounded-full border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/10 transition',
        '🗑');
    btnEliminar.type = 'button';
    btnEliminar.title = 'Eliminar de Mi lista';
    btnEliminar.addEventListener('click', (event) => {
        event.stopPropagation();
        eliminarFavorito(fav.id);
    });

    // Al seleccionar el elemento de Mi lista, se refleja en "En primer plano".
    item.addEventListener('click', () => seleccionarFavorito(fav));
    item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            seleccionarFavorito(fav);
        }
    });

    item.append(img, info, btnEliminar);
    return item;
}

/**
 * Abre el panel lateral "Mi lista".
 */
function abrirDrawer() {
    renderizarFavoritos(); // re-pinta para repetir la animación de entrada de los items
    drawer.classList.remove('translate-x-full');
    drawerOverlay.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

/**
 * Cierra el panel lateral "Mi lista".
 */
function cerrarDrawer() {
    drawer.classList.add('translate-x-full');
    drawerOverlay.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

// ===== Eventos del panel de favoritos =====
btnFavoritos.addEventListener('click', abrirDrawer);
btnCerrarDrawer.addEventListener('click', cerrarDrawer);
drawerOverlay.addEventListener('click', cerrarDrawer);

// Cierra el panel "Mi lista" con la tecla Escape.
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cerrarDrawer();
});

/**
 * Vacía por completo la lista de guardados (pide confirmación antes).
 */
btnVaciar.addEventListener('click', () => {
    if (!leerFavoritos().length) return;
    if (confirm('¿Seguro que quieres vaciar toda tu lista de guardados?')) {
        guardarFavoritos([]);
        renderizarFavoritos();
        sincronizarBotones();
    }
});

/**
 * Atajo para crear un elemento con clase(s) y texto (usando textContent, seguro ante XSS).
 * @param {string} tag - Etiqueta HTML (div, img, p, ...).
 * @param {string} className - Clases de Tailwind.
 * @param {string} [text] - Texto opcional.
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * Devuelve la mejor URL de imagen disponible (prioriza "original", que es la de mayor resolución).
 * @param {Object} show - Objeto de serie de TVMaze.
 * @returns {string} URL de la imagen o el placeholder.
 */
function imagen(show) {
    if (!show.image) return PLACEHOLDER;
    return show.image.original || show.image.medium || PLACEHOLDER;
}

/**
 * Formatea la calificación promedio (o "N/D" si no existe).
 * @param {Object} show
 * @returns {string}
 */
function notaTexto(show) {
    return (show.rating && show.rating.average != null) ? show.rating.average.toFixed(1) : 'N/D';
}

/**
 * Convierte el HTML del resumen que entrega la API en texto plano
 * (evita inyectar etiquetas ajenas en la página).
 * @param {string} html
 * @returns {string}
 */
function limpiarHTML(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent.trim();
}

/**
 * Muestra el estado de ERROR con el mensaje indicado.
 * @param {string} mensaje
 */
function mostrarError(mensaje) {
    errorText.textContent = mensaje;
    errorMessage.classList.remove('hidden');
}

/**
 * Oculta todas las secciones de respuesta (error, destacado, header y grilla).
 * Se usa antes de cada nueva búsqueda y antes de mostrar un error.
 */
function ocultarRespuestas() {
    errorMessage.classList.add('hidden');
    featuredSection.classList.add('hidden');
    resultsHeader.classList.add('hidden');
    resultsGrid.classList.add('hidden');
}

// ===== Arranque =====
// Al terminar de cargar el DOM, pintar los favoritos guardados (persistencia al recargar).
document.addEventListener('DOMContentLoaded', () => {
    renderizarFavoritos();
});

// Búsqueda de ejemplo al cargar la página (muestra el estado de éxito de inmediato).
window.addEventListener('load', () => {
    searchInput.value = 'Breaking Bad';
    buscarSeries('Breaking Bad');
});
