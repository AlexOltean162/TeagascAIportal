 // Custom cursor elements
 const cursor = document.querySelector('.cursor');
 const cursorGlow = document.querySelector('.cursor-glow');

 document.addEventListener('mousemove', (e) => {
   // Move cursor dot
   cursor.style.left = e.clientX + 'px';
   cursor.style.top = e.clientY + 'px';

   // Move glow effect
   cursorGlow.style.left = e.clientX + 'px';
   cursorGlow.style.top = e.clientY + 'px';

   // Change cursor color when over cards, buttons, or modal icons with a smooth transition
   const target = e.target;
   if (
     target.closest('.card') ||
     target.closest('.card-button') ||
     target.closest('.app-icon') ||
     target.closest('.close-modal') ||
     target.closest('.modal-body') ||
     target.closest('.modal-header') ||
     target.closest('.folder-modal-content') ||
     target.closest('footer') ||
     target.closest('.footer-link') 
   ) {
     cursor.style.backgroundColor = 'rgba(143, 0, 0, 0.7)';
     cursorGlow.style.backgroundColor = 'rgba(143, 0, 0, 0.3)';
     cursorGlow.style.width = '60px';
     cursorGlow.style.height = '60px';
   } else {
     cursor.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
     cursorGlow.style.background = 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%)';
     cursorGlow.style.width = '40px';
     cursorGlow.style.height = '40px';
   }

   // Interactive Background Gradient
   const x = e.clientX / window.innerWidth;
   const y = e.clientY / window.innerHeight;

   document.body.style.background = `linear-gradient(
       ${135 + x * 30}deg, 
       hsla(115, 90%, ${15 + y * 5}%, 0.8),
       hsla(50, 50%, ${40 + x * 5}%, 0.8)
   )`;
 });

 // RAG Bots Modal references
 const ragBotsButton = document.getElementById('ragBotsButton');
 const ragBotsModal = document.getElementById('ragBotsModal');
 const closeModalButton = document.getElementById('closeModalButton');
 const appIcons = document.querySelectorAll('.app-icon');

 // Open the RAG Bots modal
 ragBotsButton.addEventListener('click', (e) => {
   e.stopPropagation();
   ragBotsModal.classList.add('show');
 });

 // Close the modal when clicking the close button or clicking outside the modal content
 closeModalButton.addEventListener('click', () => {
   ragBotsModal.classList.remove('show');
 });

 ragBotsModal.addEventListener('click', (e) => {
   // If user clicks outside the .folder-modal-content, close the modal
   if (!e.target.closest('.folder-modal-content')) {
     ragBotsModal.classList.remove('show');
   }
 });

 // Example: handle launching a RAG Bot when its icon is clicked
 appIcons.forEach(icon => {
   icon.addEventListener('click', (e) => {
     e.stopPropagation();
     const botName = icon.dataset.bot;
     alert(`Launching RAG Bot: ${botName}`);

     // Close the modal after launching
     ragBotsModal.classList.remove('show');
   });
 });

 // Card hover effects
 const cards = document.querySelectorAll('.card');
 cards.forEach(card => {
   card.addEventListener('mouseenter', () => {
     card.style.transform = 'translateY(-10px)';
   });
   card.addEventListener('mouseleave', () => {
     card.style.transform = 'translateY(0)';
   });
 });

 // Disable the custom cursor on touch devices
 if ('ontouchstart' in window) {
   document.body.style.cursor = 'auto';
   cursor.style.display = 'none';
   cursorGlow.style.display = 'none';
 }