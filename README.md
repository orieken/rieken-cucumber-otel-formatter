# @rieken/cucumber-otel-formatter


`@rieken/cucumber-otel-reporter` is a custom CucumberJS reporter built in TypeScript to enhance test observability by sending test results as both tracing data and metrics directly to OpenTelemetry and Prometheus. This reporter captures information for each test scenario and sends it to pre-configured OTLP and Prometheus endpoints, allowing for real-time monitoring of test success rates, durations, and failures.

## Features

- **OpenTelemetry Integration**: Sends trace data for each test scenario, including the test status (passed, failed, or pending), duration, and custom attributes.
- **Prometheus Metrics Collection**: Tracks scenario counts and durations as metrics, accessible to a Prometheus server for easy aggregation and analysis.
- **Configurable Endpoints**: Allows users to specify OTLP and Prometheus endpoints via a JSON configuration file.

## Installation

\`\`\`bash
npm install @rieken/cucumber-otel-reporter
\`\`\`

## Configuration

Create a JSON configuration file (e.g., \`otel-config.json\`) with the required endpoints and service name. Example:

\`\`\`json
{
"otelServiceUrl": "http://localhost:50052/v1/traces",
"prometheusMetricsUrl": "http://localhost:50080/metrics",
"serviceName": "CucumberOtelTestService"
}
\`\`\`

### Configuration Options

- \`otelServiceUrl\`: URL for the OpenTelemetry trace endpoint (e.g., OTLP HTTP endpoint on port \`50052\`).
- \`prometheusMetricsUrl\`: URL for the Prometheus metrics endpoint (e.g., Prometheus server on port \`50080\`).
- \`serviceName\`: Custom name for the service used in trace data and metrics.

## Usage

Run CucumberJS with the custom formatter and point it to the configuration file:

\`\`\`bash
npx cucumber-js --require-module ts-node/register --format @rieken/cucumber-otel-reporter ./path/to/otel-config.json
\`\`\`

### Metrics Exposed

1. **Total Scenarios Run**: Tracks the count of scenarios based on their status (passed, failed, pending).
2. **Scenario Duration**: Records the duration of each scenario in seconds.

### Trace Attributes

Each trace captures:
- **Scenario Name**: The name of the Cucumber scenario.
- **Status**: The test status (passed, failed, pending).
- **Duration**: Duration in seconds.
- **Test Run Name**: Optional name of the test run, if provided by the Cucumber test run.

## Example

Given a test scenario in CucumberJS, this reporter will:
1. Capture the test status and duration for each scenario.
2. Send trace data to the specified OTLP endpoint in OpenTelemetry.
3. Send Prometheus-compatible metrics to the specified Prometheus metrics endpoint.

This allows for real-time monitoring and analysis, enabling better insights into test performance and reliability.

## Requirements

Ensure your system meets the following requirements:
- **OpenTelemetry**: Your endpoint should support OTLP HTTP for traces (default is \`http://localhost:50052\`).
- **Prometheus**: Prometheus server should be accessible to scrape metrics from the configured URL (default is \`http://localhost:50080\`).

## License

MIT License
