import { useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import api from '../services/api';

const CAMPOS_REQUERIDOS = ['claimant_name','claimant_email','work_description','infringing_urls','signature'];

export default function DMCA() {
  const params = new URLSearchParams(window.location.search);
  const patronIdParam = params.get('patron_id') || '';
  const urlParam = params.get('url') || '';
  const desdePatron = !!patronIdParam;

  const [form, setForm] = useState({
    claimant_name: '', claimant_email: '', claimant_company: '', claimant_address: '',
    work_description: '', infringing_urls: urlParam, patron_id: patronIdParam,
    proof_url: '', registro_obra: '',
    good_faith: false, accuracy: false, signature: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    for (const c of CAMPOS_REQUERIDOS) {
      if (!form[c]?.trim()) { setError('Por favor completa todos los campos obligatorios.'); return; }
    }
    if (desdePatron && !form.proof_url?.trim()) {
      setError('Debes proporcionar una URL que compruebe que eres la autora original del diseño.'); return;
    }
    if (!form.good_faith || !form.accuracy) {
      setError('Debes aceptar ambas declaraciones juradas.'); return;
    }
    setEnviando(true);
    try {
      await api.post('/dmca', form);
      setEnviado(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al enviar. Intenta de nuevo.');
    } finally { setEnviando(false); }
  };

  if (enviado) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
      <h1 className="text-2xl font-bold mb-2">Reclamación recibida</h1>
      <p className="text-gray-400 mb-4">
        Hemos recibido tu notificación. Tu solicitud será <strong>canalizada al área especializada</strong> para
        su revisión en un plazo de <strong>3–5 días hábiles</strong>. Recibirás una respuesta en el correo proporcionado.
      </p>
      <p className="text-sm text-gray-500">
        Ningún contenido es modificado ni retirado de forma automática. Cada reclamación es evaluada
        manualmente por nuestro equipo antes de tomar cualquier acción.
      </p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="w-8 h-8 text-crochet-primary shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Política de Derechos de Autor (DMCA)</h1>
          <p className="text-gray-400 text-sm">Digital Millennium Copyright Act · Safe Harbor</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-5 mb-8 text-sm text-gray-300 space-y-3">
        <p>
          CrochetFlix respeta los derechos de propiedad intelectual y cumple con la legislación aplicable
          en materia de derechos de autor. De conformidad con la <strong>Sección 512 del DMCA</strong> y
          la <strong>Ley Federal del Derecho de Autor de México (LFDA)</strong>, procesamos las notificaciones
          de retiro de contenido infractor de manera diligente.
        </p>
        <p>
          Si eres titular de derechos de autor y crees que algún contenido en esta plataforma infringe tus
          derechos, puedes enviar una notificación formal completando el formulario a continuación.
          Tu solicitud será <strong>canalizada al área especializada de revisión</strong>, quien evaluará cada caso
          de forma individual antes de tomar cualquier acción.
        </p>
        <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-yellow-200 text-xs">
            Una declaración falsa o de mala fe puede resultar en responsabilidad legal bajo la Sección 512(f) del DMCA.
          </p>
        </div>
        <p className="text-xs text-gray-500">
          <strong>Agente de DMCA:</strong> CrochetFlix — contacto: <a href="mailto:crochetflix@proton.me" className="text-crochet-primary hover:underline">crochetflix@proton.me</a>
          {' · '}
          <a href="/derechos-de-autor" className="text-crochet-primary hover:underline">Consultar política completa de derechos de autor</a>
        </p>
      </div>

      <form onSubmit={enviar} className="space-y-5">
        <h2 className="text-lg font-semibold">Formulario de Notificación de Retiro</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nombre completo *</label>
            <input value={form.claimant_name} onChange={e => set('claimant_name', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Correo electrónico *</label>
            <input type="email" value={form.claimant_email} onChange={e => set('claimant_email', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Empresa / Marca (opcional)</label>
            <input value={form.claimant_company} onChange={e => set('claimant_company', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Dirección postal (opcional)</label>
            <input value={form.claimant_address} onChange={e => set('claimant_address', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Descripción de la obra original *</label>
          <p className="text-xs text-gray-500 mb-1">Describe la obra protegida por derechos de autor que crees que fue infringida.</p>
          <textarea value={form.work_description} onChange={e => set('work_description', e.target.value)}
            rows={3} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">URLs del contenido infractor *</label>
          <p className="text-xs text-gray-500 mb-1">Incluye las URLs exactas. Una por línea.</p>
          <textarea value={form.infringing_urls} onChange={e => set('infringing_urls', e.target.value)}
            rows={3} placeholder="https://crochetflix.app/patron/..." className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary font-mono" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">ID del patrón (opcional)</label>
          <p className="text-xs text-gray-500 mb-1">Si conoces el ID del patrón en la URL (ej. <span className="font-mono">patron-ab12cd34</span>).</p>
          <input value={form.patron_id} onChange={e => set('patron_id', e.target.value)}
            placeholder="patron-xxxxxxxx" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary font-mono" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Número de registro (opcional)</label>
          <p className="text-xs text-gray-500 mb-1">
            Número de registro ante <strong>INDAUTOR</strong>, ISBN, número de depósito legal u otro registro oficial de la obra.
          </p>
          <input value={form.registro_obra} onChange={e => set('registro_obra', e.target.value)}
            placeholder="Ej: 03-2024-XXXXXXXX, ISBN 978-XXX, etc."
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
        </div>

        {desdePatron && (
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
            <label className="block text-sm font-semibold text-blue-200 mb-1">
              Comprobación de autoría *
            </label>
            <p className="text-xs text-blue-300 mb-2">
              Para proteger a los creadores y evitar reclamaciones falsas, debes proporcionar una URL
              donde hayas publicado originalmente este diseño <strong>antes</strong> de que aparezca en CrochetFlix
              (tu tienda de Etsy, Ravelry, Instagram, página web, etc.).
            </p>
            <input
              value={form.proof_url}
              onChange={e => set('proof_url', e.target.value)}
              placeholder="https://www.etsy.com/listing/... o https://www.ravelry.com/patterns/..."
              className="w-full bg-gray-800 border border-blue-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
            <p className="text-xs text-gray-500 mt-1">
              Esta información es revisada manualmente por nuestro equipo antes de tomar cualquier acción.
            </p>
          </div>
        )}

        <div className="space-y-3 bg-gray-800/50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300">Declaraciones juradas requeridas</h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={form.good_faith} onChange={e => set('good_faith', e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-crochet-primary shrink-0" />
            <span className="text-xs text-gray-300">
              Declaro de buena fe que el uso del material identificado no está autorizado por el titular de los derechos,
              su agente, ni por la ley.
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={form.accuracy} onChange={e => set('accuracy', e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-crochet-primary shrink-0" />
            <span className="text-xs text-gray-300">
              Declaro, bajo pena de perjurio, que la información contenida en esta notificación es exacta y que soy
              el titular de los derechos o estoy autorizado para actuar en nombre del titular.
            </span>
          </label>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Firma electrónica *</label>
          <p className="text-xs text-gray-500 mb-1">Escribe tu nombre completo como firma.</p>
          <input value={form.signature} onChange={e => set('signature', e.target.value)}
            placeholder="Tu nombre completo" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-300 text-sm">{error}</div>
        )}

        <button type="submit" disabled={enviando}
          className="w-full py-3 bg-crochet-primary rounded-lg font-semibold text-white disabled:opacity-50 transition hover:opacity-90">
          {enviando ? 'Enviando…' : 'Enviar Notificación DMCA'}
        </button>

        <p className="text-xs text-gray-500 text-center">
          Para preguntas sobre derechos de autor, escríbenos a{' '}
          <a href="mailto:crochetflix@proton.me" className="text-crochet-primary hover:underline">crochetflix@proton.me</a>
        </p>
      </form>
    </div>
  );
}
