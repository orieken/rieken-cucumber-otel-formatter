import {
  SummaryFormatter,
  IFormatterOptions,
  formatterHelpers,
} from '@cucumber/cucumber'
import * as messages from '@cucumber/messages'
import { EOL as n } from 'os'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { context, Context, trace, Tracer } from '@opentelemetry/api';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { Resource } from '@opentelemetry/resources';
import { TestStepResult, TestStepResultStatus } from '@cucumber/messages';
const { GherkinDocumentParser, PickleParser } = formatterHelpers
const { getGherkinScenarioMap, getGherkinStepMap } =
  GherkinDocumentParser
const { getPickleStepMap } = PickleParser

class CurrentStep {
  name: string
  keyword: string
  text: string
  line: number
  status?: messages.TestStepResultStatus
  duration?: messages.Duration
  error?: string
  file: string
  context?: Context

  constructor(
    name: string,
    keyword: string,
    text: string,
    line: number,
    file: string
  ) {
    this.name = name
    this.keyword = keyword
    this.text = text
    this.line = line
    this.file = file
  }
}

class CurrentScenario {
  name: string
  line: number
  file: string
  steps: CurrentStep[] = []
  status?: TestStepResultStatus
  duration?: TestStepResult
  context?: Context

  constructor(name: string, line: number, file: string) {
    this.name = name
    this.line = line
    this.file = file
  }
}

class CurrentFeature {
  name: string
  line: number
  file: string
  scenarios: CurrentScenario[] = []
  context?: Context

  constructor(name: string, line: number, file: string) {
    this.name = name
    this.line = line
    this.file = file
  }
}

class CurrentTestRun {
  features: CurrentFeature[] = []
  startTime?: messages.Timestamp
  endTime?: messages.Timestamp
  success?: boolean
  context?: Context
}

export default class OtelFormatter extends SummaryFormatter {
  private currentTestRun: CurrentTestRun = new CurrentTestRun()
  private currentFeature?: CurrentFeature
  private currentScenario?: CurrentScenario
  private uri?: string
  private tracer: Tracer
  private provider: NodeTracerProvider

  constructor(options: IFormatterOptions) {
    super(options)

    // Initialize OpenTelemetry
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION,
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: process.env.OTEL_SERVICE_NAMESPACE,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || process.env.OTEL_DEFAULT_ENVIRONMENT
      }),
    })

    // Configure OTLP exporter
    const otlpExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: {},
      timeoutMillis: parseInt(process.env.OTEL_EXPORTER_OTLP_TIMEOUT || '15000'),
    })

    // Add SpanProcessor to the provider
    this.provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter))

    // Register the provider
    this.provider.register()

    // Get a tracer
    this.tracer = trace.getTracer(process.env.OTEL_SERVICE_NAME || 'cucumber-tests')

    options.eventBroadcaster.on('envelope', this.parseEnvelope.bind(this))
  }

  private parseEnvelope(envelope: messages.Envelope): void {
    if (envelope.testRunStarted) this.onTestRunStarted(envelope.testRunStarted)
    if (envelope.testCaseStarted) this.onTestCaseStarted(envelope.testCaseStarted)
    if (envelope.testStepStarted) this.onTestStepStarted(envelope.testStepStarted)
    if (envelope.testStepFinished)
      this.onTestStepFinished(envelope.testStepFinished)
    if (envelope.testCaseFinished)
      this.onTestCaseFinished(envelope.testCaseFinished)
    if (envelope.testRunFinished) this.onTestRunFinished(envelope.testRunFinished)
  }

  private onTestRunStarted(testRunStarted: messages.TestRunStarted): void {
    const rootSpan = this.tracer.startSpan('test-run', {
      attributes: {
        'test.type': 'test-run',
        'test.status': 'started'
      }
    });
    this.currentTestRun.context = trace.setSpan(context.active(), rootSpan);
    this.currentTestRun.startTime = testRunStarted.timestamp;
  }

  private onTestCaseStarted(testCaseStarted: messages.TestCaseStarted): void {
    const { gherkinDocument, pickle } =
      this.eventDataCollector.getTestCaseAttempt(testCaseStarted.id)

    if (!gherkinDocument.feature) {
      throw new Error('Feature is missing from gherkin document')
    }

    const gherkinScenarioMap = getGherkinScenarioMap(gherkinDocument)
    if (!pickle.astNodeIds) throw new Error('Pickle AST nodes missing')
    const scenario = gherkinScenarioMap[pickle.astNodeIds[0]]

    this.currentScenario = new CurrentScenario(
      pickle.name,
      scenario.location.line,
      this.uri || ''
    )

    // Create scenario span as child of test run
    const scenarioSpan = this.tracer.startSpan(
      `scenario: ${this.currentScenario.name}`,
      {
        attributes: {
          'test.type': 'scenario',
          'test.scenario.name': this.currentScenario.name,
          'test.scenario.line': this.currentScenario.line,
          'test.scenario.file': this.currentScenario.file
        }
      },
      this.currentTestRun.context // Use test run context as parent
    )
    this.currentScenario.context = trace.setSpan(context.active(), scenarioSpan)

    if (this.currentFeature) {
      this.currentFeature.scenarios.push(this.currentScenario)
    }
  }

  private onTestStepStarted(testStepStarted: messages.TestStepStarted): void {
    const { gherkinDocument, pickle, testCase } =
      this.eventDataCollector.getTestCaseAttempt(
        testStepStarted.testCaseStartedId
      )

    const pickleStepMap = getPickleStepMap(pickle)
    const gherkinStepMap = getGherkinStepMap(gherkinDocument)
    const testStep = testCase.testSteps.find(
      (item) => item.id === testStepStarted.testStepId
    )

    if (testStep && testStep.pickleStepId && this.currentScenario) {
      const pickleStep = pickleStepMap[testStep.pickleStepId]
      const astNodeId = pickleStep.astNodeIds[0]
      const gherkinStep = gherkinStepMap[astNodeId]

      const step = new CurrentStep(
        `${gherkinStep.keyword}${pickleStep.text}`,
        gherkinStep.keyword,
        pickleStep.text,
        gherkinStep.location.line,
        this.uri || ''
      )

      // Create step span as child of scenario
      const stepSpan = this.tracer.startSpan(
        `step: ${step.name}`,
        {
          attributes: {
            'test.type': 'step',
            'test.step.name': step.name,
            'test.step.keyword': step.keyword,
            'test.step.text': step.text,
            'test.step.line': step.line,
            'test.step.file': step.file
          }
        },
        this.currentScenario.context // Use scenario context as parent
      )
      step.context = trace.setSpan(context.active(), stepSpan)
      this.currentScenario.steps.push(step)
    }
  }

  private onTestStepFinished(testStepFinished: messages.TestStepFinished): void {
    if (this.currentScenario && this.currentScenario.steps.length > 0) {
      const currentStep =
        this.currentScenario.steps[this.currentScenario.steps.length - 1]
      currentStep.status = testStepFinished.testStepResult.status
      currentStep.duration = testStepFinished.testStepResult.duration

      if (testStepFinished.testStepResult.message) {
        currentStep.error = testStepFinished.testStepResult.message
      }

      // End step span
      if (currentStep.context) {
        const stepSpan = trace.getSpan(currentStep.context)
        if (stepSpan) {
          stepSpan.setAttributes({
            'test.step.status': this.mapStatus(testStepFinished.testStepResult.status),
            'test.step.duration.seconds': testStepFinished.testStepResult.duration?.seconds || 0,
            'test.step.error': testStepFinished.testStepResult.message || ''
          })
          stepSpan.end()
        }
      }
    }
  }

  private onTestCaseFinished(testCaseFinished: messages.TestCaseFinished): void {
    const testCaseAttempt = this.eventDataCollector.getTestCaseAttempt(
      testCaseFinished.testCaseStartedId
    )

    if (this.currentScenario) {
      // Update scenario status and duration
      if (testCaseAttempt.stepResults) {
        this.currentScenario.status = testCaseAttempt.stepResults.status as unknown as messages.TestStepResultStatus;
        this.currentScenario.duration = testCaseAttempt.stepResults.duration;
      }

      // End scenario span
      const scenarioContext = this.currentScenario.context
      if (scenarioContext) {
        const scenarioSpan = trace.getSpan(scenarioContext)
        if (scenarioSpan && testCaseAttempt.stepResults) {
          scenarioSpan.setAttributes({
            'test.scenario.status': this.mapStatus(testCaseAttempt.worstTestStepResult as unknown as TestStepResultStatus),
            'test.scenario.duration.seconds': (testCaseAttempt.stepResults.duration || 0) as unknown as number,
            'test.scenario.name': this.currentScenario.name,
            'test.scenario.file': this.currentScenario.file,
            'test.scenario.line': this.currentScenario.line
          })
          scenarioSpan.end()
        }
      }
    }
  }

  private onTestRunFinished(testRunFinished: messages.TestRunFinished): void {
    this.currentTestRun.endTime = testRunFinished.timestamp
    this.currentTestRun.success = testRunFinished.success

    // End test run span
    const testRunContext = this.currentTestRun.context
    if (testRunContext) {
      const testRunSpan = trace.getSpan(testRunContext)
      if (testRunSpan) {
        testRunSpan.setAttributes({
          'test.status': testRunFinished.success ? 'passed' : 'failed',
          'test.success': testRunFinished.success
        })
        testRunSpan.end()
      }
    }

    // Output the final test run data
    this.log(JSON.stringify(this.currentTestRun, null, 2))
    this.log(n)
  }

  private mapStatus(status?: messages.TestStepResultStatus): string {
    switch (status) {
      case messages.TestStepResultStatus.PASSED:
        return 'ok'
      case messages.TestStepResultStatus.FAILED:
        return 'error'
      case messages.TestStepResultStatus.SKIPPED:
      case messages.TestStepResultStatus.PENDING:
      case messages.TestStepResultStatus.UNDEFINED:
      case messages.TestStepResultStatus.AMBIGUOUS:
      case messages.TestStepResultStatus.UNKNOWN:
        return 'unset'
      default:
        return 'unset'
    }
  }
}
