// The assistants shown in the hub, grouped as they appear in the sidebar.
// To add an assistant: add an entry here and an nginx location that proxies its URL to the app
// (see deploy/nginx-assistants.conf), then give the character a new look in character.js.
//
//   id        used in the address (assistants/#id); keep it short and stable
//   summary   one line under the name on the assistant's welcome screen
//   url       where the app's API is served, relative to this page
//   health    the app's health check, relative to url (the apps have no pages of their own)
//   adapter   which API it speaks (see adapters.js): "research" or "policy"
//   look      which accessory the character wears for this assistant
//   searching, reading   status lines while the "policy" adapter works (optional)
//   filters   false to hide the app's filters (optional)
window.TEAGASC_ASSISTANTS = {
  portalUrl: "../",
  // Voice questions for every assistant are transcribed by the Policy Assistant's endpoint.
  transcribeUrl: "policy/api/transcribe",
  groups: [
    {
      label: "Organisation",
      assistants: [
        {
          id: "policy",
          name: "Policy Assistant",
          summary: "Teagasc policies and procedures",
          url: "policy/",
          health: "healthz",
          adapter: "policy",
          look: "tie",
          searching: "Searching the Policies Hub",
          reading: "Reading the policies"
        },
        {
          id: "handbook",
          name: "Staff Handbook",
          summary: "Leave, pay and terms of employment",
          url: "handbook/",
          health: "healthz",
          adapter: "policy",
          look: "badge",
          searching: "Searching the Staff Handbook",
          reading: "Reading the handbook",
          filters: false  // its only "departments" are the handbook folder and a forms sub-folder
        }
      ]
    },
    {
      label: "Research",
      assistants: [
        {
          id: "research",
          name: "Research Papers",
          summary: "Teagasc research, authors and research gaps",
          url: "research/",
          health: "health",
          adapter: "research",
          look: "goggles"
        }
      ]
    }
  ]
};
