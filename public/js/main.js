// TechMinds MCQ App - Main JavaScript

document.addEventListener('DOMContentLoaded', function() {

  // ── Auto-dismiss alerts after 5 seconds ──
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });

  // ── Close sidebar on mobile when clicking outside ──
  document.addEventListener('click', function(e) {
    const sidebar = document.getElementById('sidebar');
    const toggle  = document.querySelector('.sidebar-toggle');
    if (sidebar && toggle && window.innerWidth <= 1024) {
      if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // ANTI-DOUBLE-SUBMIT: disable every submit button on first click
  // and show a loading indicator, so clicking twice has no effect.
  // ─────────────────────────────────────────────────────────────
  document.querySelectorAll('form').forEach(form => {
    // Skip forms that use GET (search, filters) or the Excel upload
    // which needs the file to actually finish uploading
    if (form.method && form.method.toUpperCase() === 'GET') return;

    form.addEventListener('submit', function(e) {
      // If already submitting, block the second submission entirely
      if (form.dataset.submitting === 'true') {
        e.preventDefault();
        return false;
      }
      form.dataset.submitting = 'true';

      // Disable all submit buttons and show loading text
      form.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Please wait…';
      });

      // Safety net: re-enable after 8 seconds in case of server error
      setTimeout(() => {
        form.dataset.submitting = 'false';
        form.querySelectorAll('button[type="submit"]').forEach(btn => {
          btn.disabled = false;
          if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
        });
      }, 8000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PRG guard: replace the current history entry so that pressing
  // the browser Back button after a redirect does NOT re-submit.
  // Only runs when we land on a page after a redirect (no form).
  // ─────────────────────────────────────────────────────────────
  if (window.performance && window.performance.navigation.type === 0) {
    // Fresh load – replace state so back never triggers POST replay
    history.replaceState(null, '', window.location.href);
  }
});

