import { ShieldCheck, FileText, Mail, Globe, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

const Seccion = ({ id, titulo, children }) => (
  <section id={id} className="mb-10">
    <h2 className="text-lg font-bold text-white mb-3 border-b border-gray-700 pb-2">{titulo}</h2>
    <div className="text-sm text-gray-300 space-y-3">{children}</div>
  </section>
);

export default function DerechosDeAutor() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-start gap-4 mb-2">
        <ShieldCheck className="w-9 h-9 text-crochet-primary shrink-0 mt-1" />
        <div>
          <h1 className="text-2xl font-bold">Política de Derechos de Autor</h1>
          <p className="text-gray-400 text-sm mt-0.5">CrochetFlix · Versión 1.0 · Última actualización: mayo 2025</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 my-6 text-xs">
        <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1">DMCA §512 (EE.UU.)</span>
        <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1">LFDA México</span>
        <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1">INDAUTOR</span>
        <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1">Safe Harbor</span>
      </div>

      <div className="bg-gray-800 rounded-xl p-4 mb-8 text-xs text-gray-400">
        Este documento establece la política de CrochetFlix respecto a la protección de la propiedad
        intelectual, el proceso para notificar contenido presuntamente infractor y los derechos de
        respuesta de los titulares del contenido. Aplica a todos los usuarios de la plataforma.
      </div>

      <div className="bg-gray-800/50 rounded-xl p-4 mb-10 text-sm">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contenido</p>
        <ol className="space-y-1 text-gray-300 list-decimal list-inside">
          {[
            ['1', 'marco-legal', 'Marco Legal Aplicable'],
            ['2', 'compromiso', 'Compromiso con los Creadores'],
            ['3', 'notificacion', 'Proceso de Notificación de Retiro'],
            ['4', 'revision', 'Proceso de Revisión Interna'],
            ['5', 'contra-notificacion', 'Contra-Notificación'],
            ['6', 'reincidencia', 'Política de Reincidencia'],
            ['7', 'indautor', 'Registro INDAUTOR y Legislación Mexicana'],
            ['8', 'contacto', 'Agente de Derechos de Autor y Contacto'],
          ].map(([n, id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-crochet-primary hover:underline">{n}. {label}</a>
            </li>
          ))}
        </ol>
      </div>

      <Seccion id="marco-legal" titulo="1. Marco Legal Aplicable">
        <p>CrochetFlix opera bajo las siguientes disposiciones legales en materia de derechos de autor:</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong>Digital Millennium Copyright Act (DMCA), 17 U.S.C. §512</strong> — Ley de derechos
            de autor de los Estados Unidos que otorga a los proveedores de servicios en línea protección
            ("safe harbor") frente a reclamaciones por contenido infractor subido por terceros, siempre
            que el proveedor actúe con prontitud para retirar el contenido al recibir una notificación válida.
          </li>
          <li>
            <strong>Ley Federal del Derecho de Autor (LFDA) de México</strong> — Publicada en el Diario
            Oficial de la Federación y administrada por el Instituto Nacional del Derecho de Autor
            (INDAUTOR), esta ley protege las obras literarias, artísticas y de diseño, incluyendo los
            patrones de tejido y crochet como obras de arte aplicado.
          </li>
          <li>
            <strong>Convenio de Berna para la Protección de las Obras Literarias y Artísticas</strong> —
            Tratado internacional del que México es parte, que establece la protección automática de las
            obras originales desde su creación, sin necesidad de registro formal.
          </li>
        </ul>
      </Seccion>

      <Seccion id="compromiso" titulo="2. Compromiso con los Creadores">
        <p>
          Los patrones de crochet y tejido son obras originales creadas con esfuerzo, talento y tiempo
          por diseñadoras independientes. CrochetFlix reconoce y valora este trabajo. Nuestra plataforma
          actúa únicamente como intermediaria técnica y no reivindica propiedad sobre ninguno de los
          diseños disponibles.
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>Atender todas las notificaciones de derechos de autor con seriedad y diligencia.</li>
          <li>Revisar cada caso de forma individual antes de tomar cualquier acción sobre el contenido.</li>
          <li>Acreditar a la diseñadora original en cada patrón publicado.</li>
          <li>No retirar contenido de forma automática o sin verificación previa.</li>
        </ul>
      </Seccion>

      <Seccion id="notificacion" titulo="3. Proceso de Notificación de Retiro (Takedown Notice)">
        <p>Para enviar una notificación válida bajo el DMCA o la LFDA, el titular de derechos debe proporcionar:</p>
        <ol className="list-decimal list-inside space-y-1 pl-2">
          <li>Nombre completo y datos de contacto (correo electrónico).</li>
          <li>Descripción detallada de la obra original cuyos derechos se reclaman.</li>
          <li>URL(s) específica(s) del contenido presuntamente infractor en CrochetFlix.</li>
          <li>
            <strong>Prueba de autoría</strong>: URL donde la obra fue publicada originalmente por el
            titular (tienda de Etsy, Ravelry, página web personal, Instagram, etc.), con fecha anterior
            a la publicación en CrochetFlix.
          </li>
          <li>Declaración de buena fe.</li>
          <li>Declaración bajo pena de perjurio.</li>
          <li>Firma electrónica (nombre completo escrito).</li>
        </ol>
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3 mt-3">
          <p className="text-blue-200">
            Las notificaciones pueden enviarse a través del{' '}
            <Link to="/dmca" className="text-crochet-primary hover:underline font-semibold">
              Formulario de Notificación DMCA
            </Link>{' '}
            o directamente a{' '}
            <a href="mailto:dmca@crochetflix.app" className="text-crochet-primary hover:underline">
              dmca@crochetflix.app
            </a>.
          </p>
        </div>
      </Seccion>

      <Seccion id="revision" titulo="4. Proceso de Revisión Interna">
        <ol className="list-decimal list-inside space-y-2 pl-2">
          <li><strong>Acuse de recibo</strong> — Confirmación dentro de las 24 horas hábiles siguientes.</li>
          <li><strong>Verificación de la notificación</strong> — Se comprobará que contenga todos los elementos requeridos.</li>
          <li><strong>Evaluación del caso</strong> — Se revisará el contenido identificado.</li>
          <li><strong>Notificación al titular del contenido</strong> — Si el contenido es retirado, el responsable será informado.</li>
        </ol>
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mt-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-yellow-200 text-xs">
            <strong>Ningún contenido es retirado de forma automática.</strong> Toda reclamación es
            evaluada manualmente por nuestro equipo antes de tomar cualquier acción.
          </p>
        </div>
      </Seccion>

      <Seccion id="contra-notificacion" titulo="5. Contra-Notificación">
        <p>Si tu contenido fue retirado y consideras que la reclamación es errónea, tienes derecho a presentar una contra-notificación que incluya:</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>Tu nombre completo y datos de contacto.</li>
          <li>Identificación del contenido retirado.</li>
          <li>Declaración bajo pena de perjurio de que el retiro fue un error.</li>
          <li>Firma electrónica.</li>
        </ul>
        <p>
          Envía tu contra-notificación a{' '}
          <a href="mailto:dmca@crochetflix.app" className="text-crochet-primary hover:underline">dmca@crochetflix.app</a>{' '}
          con el asunto <span className="font-mono text-xs bg-gray-700 px-1 rounded">CONTRA-NOTIFICACION: [ID de reclamación]</span>.
        </p>
      </Seccion>

      <Seccion id="reincidencia" titulo="6. Política de Reincidencia">
        <p>
          De conformidad con la Sección 512(i) del DMCA, CrochetFlix mantiene una política para
          dar de baja a los usuarios que sean reincidentes en infracciones de derechos de autor.
        </p>
      </Seccion>

      <Seccion id="indautor" titulo="7. Registro INDAUTOR y Legislación Mexicana">
        <p>
          El <strong>Instituto Nacional del Derecho de Autor (INDAUTOR)</strong> es el organismo
          gubernamental mexicano responsable de proteger y promover los derechos de autor en México.
        </p>
        <p>Bajo la <strong>Ley Federal del Derecho de Autor</strong>, los patrones de crochet pueden estar protegidos como obras de arte aplicado (Art. 13, fracción X, LFDA).</p>
        <p>La protección surge <strong>automáticamente desde la creación de la obra</strong>, sin necesidad de registro.</p>
        <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
          <Globe className="w-5 h-5 text-crochet-primary shrink-0" />
          <div>
            <p className="font-semibold text-white text-xs">INDAUTOR — Portal de Registro</p>
            <p className="text-gray-400 text-xs">indautor.gob.mx · Registro de obras literarias, artísticas y científicas</p>
          </div>
        </div>
      </Seccion>

      <Seccion id="contacto" titulo="8. Agente de Derechos de Autor y Contacto">
        <div className="bg-gray-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-crochet-primary" />
            <span className="font-semibold text-white">Agente designado de derechos de autor</span>
          </div>
          <div className="text-gray-300 pl-6 space-y-1">
            <p><strong>Plataforma:</strong> CrochetFlix</p>
            <p><strong>Correo:</strong>{' '}
              <a href="mailto:dmca@crochetflix.app" className="text-crochet-primary hover:underline">dmca@crochetflix.app</a>
            </p>
          </div>
        </div>
        <div className="pt-4 border-t border-gray-700">
          <Link
            to="/dmca"
            className="inline-flex items-center gap-2 bg-crochet-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition"
          >
            <Mail className="w-4 h-4" />
            Enviar Notificación DMCA
          </Link>
        </div>
      </Seccion>

      <p className="text-xs text-gray-600 text-center mt-10 border-t border-gray-800 pt-6">
        Este documento es de carácter informativo y no constituye asesoría legal.
        CrochetFlix se reserva el derecho de actualizar esta política en cualquier momento.
      </p>
    </div>
  );
}
