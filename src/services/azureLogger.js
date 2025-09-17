import appInsights from "applicationinsights";

let client;
if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY || process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights.setup().start();
  client = appInsights.defaultClient;
}

export const AzureLogger = {
  info: (message, properties = {}) => {
    if (client) client.trackTrace({ message, severity: 1, properties });
    console.info(message, properties);
  },
  warn: (message, properties = {}) => {
    if (client) client.trackTrace({ message, severity: 2, properties });
    console.warn(message, properties);
  },
  error: (error, properties = {}) => {
    if (client) client.trackException({ exception: error, properties });
    console.error(error, properties);
  },
  request: (req) => {
    if (client) client.trackRequest({
      name: `${req.method} ${req.originalUrl}`,
      url: req.originalUrl,
      duration: 0,
      resultCode: 0,
      success: true,
      properties: {
        method: req.method,
        url: req.originalUrl,
        user: req.user ? req.user.id : undefined,
      },
    });
  },
};