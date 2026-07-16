const fbq = (...args) => { if (typeof window !== 'undefined' && window.fbq) window.fbq(...args); };

export const pixelPageView = () => fbq('track', 'PageView');
export const pixelViewContent = (name, id) => fbq('track', 'ViewContent', { content_name: name, content_ids: [id], content_type: 'product' });
export const pixelLead = () => fbq('track', 'Lead');
export const pixelInitCheckout = () => fbq('track', 'InitiateCheckout');
export const pixelStartTrial = (value, currency = 'MXN') => fbq('track', 'StartTrial', { value, currency });
export const pixelPurchase = (value, currency = 'MXN') => fbq('track', 'Purchase', { value, currency });
