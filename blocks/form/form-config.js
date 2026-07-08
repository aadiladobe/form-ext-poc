// Central configuration for the TFS form microfrontend integration.
// Change these URLs when deploying to a real environment; the form block
// reads only from here so no other code needs to be touched.
// eslint-disable-next-line import/prefer-default-export
export const TFS_FORM_APP = {
  // URL of the built React microfrontend bundle (tfs-form-app).
  // Served over HTTPS locally so this HTTP EDS page and the HTTPS Universal
  // Editor extension can both load it without mixed-content restrictions.
  scriptUrl: 'https://localhost:3001/tfs-form.iife.js',
};
