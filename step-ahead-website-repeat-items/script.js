document.getElementById('year').textContent = new Date().getFullYear();

const form = document.getElementById('bookingForm');
const serviceSelect = document.getElementById('service');
const moveDate = document.getElementById('moveDate');
const itemsField = form.querySelector('textarea[name="items"]');
const photosInput = document.getElementById('photos');
const photoPreview = document.getElementById('photoPreview');
const estimateValue = document.getElementById('estimateValue');
const estimateNote = document.getElementById('estimateNote');

const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
moveDate.min = today.toISOString().slice(0, 10);

document.querySelectorAll('[data-service]').forEach(link => {
  link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.service;
    updateEstimate();
  });
});

document.querySelectorAll('[data-item]').forEach(button => {
  button.addEventListener('click', () => {
    const item = button.dataset.item;
    const current = itemsField.value.trim();

    // Quick-add buttons are intentionally repeatable. Every tap adds another
    // occurrence so customers can build up their item list quickly, e.g.
    // "Bed, Bed, Couch" instead of being limited to one of each item.
    itemsField.value = current ? `${current}, ${item}` : item;
    itemsField.focus();
    updateEstimate();
  });
});

photosInput.addEventListener('change', () => {
  photoPreview.innerHTML = '';
  const files = Array.from(photosInput.files || []);
  files.slice(0, 4).forEach(file => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    const image = document.createElement('img');
    image.alt = 'Selected item photo';
    image.src = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(image.src);
    card.appendChild(image);
    photoPreview.appendChild(card);
  });
  if (files.length > 4) {
    const more = document.createElement('div');
    more.className = 'preview-more';
    more.textContent = `+${files.length - 4} more`;
    photoPreview.appendChild(more);
  }
  updateEstimate();
});

// Starter broad-estimate engine. These are deliberately conservative launch rules and
// will be replaced/refined with Step Ahead's real pricing data and route calculations.
function updateEstimate() {
  const service = serviceSelect.value;
  const moveSize = form.elements.moveSize.value;
  const pickupAccess = form.elements.pickupAccess.value;
  const dropoffAccess = form.elements.dropoffAccess.value;
  const items = (itemsField.value || '').toLowerCase();

  if (!service || !moveSize) {
    estimateValue.textContent = 'Complete the move details to see an estimate';
    estimateNote.textContent = 'This is a guide only. Your final quote will be confirmed by Step Ahead Transport after reviewing your booking details, route and photos.';
    return null;
  }

  let base = service === 'House Moving' ? 650 : service === 'Furniture Delivery' ? 500 : service === 'General Transport' ? 550 : 600;
  const sizeAdd = {
    'Single / a few items': 0,
    'Small load': 200,
    '1 bedroom': 500,
    '2 bedroom': 900,
    '3+ bedroom / large move': 1500,
    'Not sure': 450
  }[moveSize] || 0;
  base += sizeAdd;

  const difficultAccess = [pickupAccess, dropoffAccess].filter(v => v === 'Stairs' || v === 'Lift / apartment').length;
  base += difficultAccess * 150;
  if (/double-door|double door|piano|safe|large wardrobe|pool table/.test(items)) base += 250;
  if (/trailer/.test(items)) base += 150;

  // Broad range: wider where the information is less certain.
  const uncertainty = moveSize === 'Not sure' || !items.trim() ? 0.30 : 0.22;
  const low = Math.max(350, Math.round((base * (1 - uncertainty)) / 50) * 50);
  const high = Math.round((base * (1 + uncertainty)) / 50) * 50;

  estimateValue.textContent = `R${low.toLocaleString('en-ZA')} – R${high.toLocaleString('en-ZA')}`;
  estimateNote.textContent = 'Broad estimate only. It is not your final quotation and may change after Step Ahead reviews the route, distance, items, access requirements and photos.';
  return { low, high };
}

['change','input'].forEach(eventName => form.addEventListener(eventName, updateEstimate));

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const estimate = updateEstimate();
  const data = new FormData(form);
  const lines = [
    'Hi Step Ahead Transport 👋 I\'ve just submitted my booking request through the Step Ahead website.',
    '',
    '*BOOKING SUMMARY*',
    `Service: ${data.get('service')}`,
    `Preferred date: ${data.get('moveDate')}`,
    `Move size: ${data.get('moveSize')}`,
  ];
  if (estimate) lines.push(`Broad website estimate: R${estimate.low.toLocaleString('en-ZA')} – R${estimate.high.toLocaleString('en-ZA')}`);
  lines.push('', 'Please review my booking details and confirm the final quote.');

  // Temporary pre-Supabase behaviour: opens WhatsApp with a notification only.
  // Once Supabase is connected, this submit handler will save the booking and photos first,
  // then show a confirmation screen with this same optional WhatsApp notification.
  const url = `https://wa.me/27605503004?text=${encodeURIComponent(lines.join('\n'))}`;
  window.open(url, '_blank', 'noopener');
});
