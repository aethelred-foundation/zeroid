import crypto from "crypto";
import { prisma, logger, redis } from "../../index";

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export type FraudSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus =
  | "active"
  | "investigating"
  | "resolved"
  | "false_positive";

export interface BiometricSignals {
  keystrokeDwellTimes?: number[];
  keystrokeFlightTimes?: number[];
  mouseVelocities?: number[];
  mouseAccelerations?: number[];
  mouseCurvatures?: number[];
  touchPressures?: number[];
  touchAreas?: number[];
  scrollPatterns?: number[];
}

export interface DeviceFingerprint {
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  canvasHash: string;
  webglHash: string;
  audioContextHash: string;
  fontList: string[];
  cpuCores: number;
  deviceMemory: number;
  hardwareConcurrency: number;
  touchSupport: boolean;
  installedPlugins: string[];
}

export interface CredentialUsageContext {
  identityId: string;
  credentialId: string;
  timestamp: Date;
  geolocation?: { lat: number; lon: number; accuracy: number };
  ipAddress: string;
  deviceFingerprint: DeviceFingerprint;
  biometricSignals?: BiometricSignals;
  actionType: "present" | "verify" | "issue" | "revoke" | "delegate";
}

export interface RiskFactor {
  name: string;
  category:
    | "biometric"
    | "device"
    | "velocity"
    | "pattern"
    | "correlation"
    | "geolocation";
  score: number; // 0-100
  weight: number; // 0-1
  description: string; // human-readable explanation
  evidence: Record<string, unknown>;
}

export interface FraudAssessment {
  assessmentId: string;
  identityId: string;
  credentialId?: string;
  overallScore: number; // 0-100 (higher = more risk)
  severity: FraudSeverity;
  factors: RiskFactor[];
  decision: "allow" | "challenge" | "block" | "review";
  explanations: string[];
  modelVersion: string;
  teeAttestationId?: string;
  processingTimeMs: number;
  timestamp: Date;
}

export interface FraudAlert {
  alertId: string;
  assessmentId: string;
  identityId: string;
  severity: FraudSeverity;
  title: string;
  description: string;
  status: AlertStatus;
  riskScore: number;
  factors: RiskFactor[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
}

// ---------------------------------------------------------------------------
// Simple Neural Network (forward pass with pre-trained weights)
// ---------------------------------------------------------------------------

interface NeuralNetworkLayer {
  weights: number[][]; // [outputDim x inputDim]
  biases: number[]; // [outputDim]
  activation: "relu" | "sigmoid" | "tanh" | "softmax";
}

class SimpleNeuralNetwork {
  private layers: NeuralNetworkLayer[];

  constructor(layers: NeuralNetworkLayer[]) {
    this.layers = layers;
  }

  predict(input: number[]): number[] {
    let current = input;

    for (const layer of this.layers) {
      const output: number[] = new Array(layer.biases.length).fill(0);

      // Matrix multiply: output = weights * input + biases
      for (let i = 0; i < layer.weights.length; i++) {
        let sum = layer.biases[i];
        for (let j = 0; j < current.length; j++) {
          sum += layer.weights[i][j] * current[j];
        }
        output[i] = sum;
      }

      // Apply activation
      current = this.applyActivation(output, layer.activation);
    }

    return current;
  }

  private applyActivation(values: number[], activation: string): number[] {
    switch (activation) {
      case "relu":
        return values.map((v) => Math.max(0, v));

      case "sigmoid":
        return values.map(
          (v) => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, v)))),
        );

      case "tanh":
        return values.map((v) => Math.tanh(v));

      case "softmax": {
        const maxVal = Math.max(...values);
        const exps = values.map((v) => Math.exp(v - maxVal));
        const sumExps = exps.reduce((a, b) => a + b, 0);
        return exps.map((e) => e / sumExps);
      }

      default:
        return values;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-trained model weights (simulated production weights)
// These would be loaded from a secure model registry in production.
// Architecture: 18-input -> 32 hidden (ReLU) -> 16 hidden (ReLU) -> 4 output (softmax)
// Outputs: [allow, challenge, block, review]
// ---------------------------------------------------------------------------

function loadPretrainedWeights(): NeuralNetworkLayer[] {
  // Deterministic pseudo-random weight generator seeded from model hash
  const seed = Buffer.from("zeroid-fraud-model-v3.2.1-prod", "utf8");
  let seedIdx = 0;
  const seededRandom = (): number => {
    const byte1 = seed[seedIdx % seed.length];
    const byte2 = seed[(seedIdx + 7) % seed.length];
    seedIdx++;
    return ((byte1 * 256 + byte2) / 65536) * 2 - 1; // range [-1, 1]
  };

  const generateWeights = (rows: number, cols: number): number[][] => {
    const scale = Math.sqrt(2.0 / cols); // He initialization
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => seededRandom() * scale),
    );
  };

  const generateBiases = (size: number): number[] =>
    Array.from({ length: size }, () => seededRandom() * 0.01);

  return [
    {
      weights: generateWeights(32, 18),
      biases: generateBiases(32),
      activation: "relu",
    },
    {
      weights: generateWeights(16, 32),
      biases: generateBiases(16),
      activation: "relu",
    },
    {
      weights: generateWeights(4, 16),
      biases: generateBiases(4),
      activation: "softmax",
    },
  ];
}

// ---------------------------------------------------------------------------
// Fraud Detection Service
// ---------------------------------------------------------------------------

export class FraudDetectionService {
  private model: SimpleNeuralNetwork;
  private readonly MODEL_VERSION = "3.2.1";
  private alerts: Map<string, FraudAlert> = new Map();

  // Velocity tracking windows (in-memory, backed by Redis in production)
  private velocityWindows: Map<
    string,
    { timestamps: number[]; windowMs: number }
  > = new Map();

  // Known device fingerprints per identity
  private knownDevices: Map<string, string[]> = new Map();

  constructor() {
    const weights = loadPretrainedWeights();
    this.model = new SimpleNeuralNetwork(weights);
    logger.info("fraud_detection_model_loaded", {
      version: this.MODEL_VERSION,
    });
  }

  // -------------------------------------------------------------------------
  // Primary assessment endpoint
  // -------------------------------------------------------------------------
  async assessFraudRisk(
    context: CredentialUsageContext,
  ): Promise<FraudAssessment> {
    const startTime = performance.now();
    const assessmentId = `fraud-${crypto.randomUUID()}`;

    logger.info("fraud_assessment_start", {
      assessmentId,
      identityId: context.identityId,
      credentialId: context.credentialId,
      actionType: context.actionType,
    });

    const factors: RiskFactor[] = [];

    // 1. Behavioral biometric analysis
    if (context.biometricSignals) {
      factors.push(...this.analyzeBiometricSignals(context));
    }

    // 2. Device fingerprint anomaly detection
    factors.push(...(await this.analyzeDeviceFingerprint(context)));

    // 3. Credential usage pattern analysis
    factors.push(...(await this.analyzeUsagePatterns(context)));

    // 4. Velocity checks
    factors.push(...(await this.performVelocityChecks(context)));

    // 5. Cross-credential correlation
    factors.push(...(await this.analyzeCrossCredentialCorrelation(context)));

    // 6. Geolocation analysis
    if (context.geolocation) {
      factors.push(...(await this.analyzeGeolocation(context)));
    }

    // 7. Build feature vector and run neural network inference
    const featureVector = this.buildFeatureVector(factors, context);
    const modelOutput = await this.runModelInference(
      featureVector,
      context.identityId,
    );

    // 8. Compute composite risk score
    const overallScore = this.computeCompositeScore(factors, modelOutput);
    const severity = this.classifySeverity(overallScore);
    const decision = this.makeDecision(modelOutput, overallScore);

    // 9. Generate human-readable explanations
    const explanations = this.generateExplanations(
      factors,
      overallScore,
      decision,
    );

    const processingTimeMs = performance.now() - startTime;

    const assessment: FraudAssessment = {
      assessmentId,
      identityId: context.identityId,
      credentialId: context.credentialId,
      overallScore,
      severity,
      factors,
      decision,
      explanations,
      modelVersion: this.MODEL_VERSION,
      processingTimeMs,
      timestamp: new Date(),
    };

    // 10. Persist assessment and create alert if needed
    await this.persistAssessment(assessment);

    if (severity === "high" || severity === "critical") {
      await this.createFraudAlert(assessment);
    }

    logger.info("fraud_assessment_complete", {
      assessmentId,
      identityId: context.identityId,
      overallScore,
      severity,
      decision,
      processingTimeMs: processingTimeMs.toFixed(2),
    });

    return assessment;
  }

  // -------------------------------------------------------------------------
  // Behavioral biometric analysis
  // -------------------------------------------------------------------------
  private analyzeBiometricSignals(
    context: CredentialUsageContext,
  ): RiskFactor[] {
    const factors: RiskFactor[] = [];
    const bio = context.biometricSignals!;

    // Keystroke dynamics — check for bot-like uniformity
    if (bio.keystrokeDwellTimes && bio.keystrokeDwellTimes.length > 5) {
      const dwellStdDev = this.standardDeviation(bio.keystrokeDwellTimes);
      const dwellMean = this.mean(bio.keystrokeDwellTimes);
      const coeffOfVariation = dwellStdDev / (dwellMean || 1);

      // Bots have very low CV (too uniform) or very high CV (random injection)
      let score = 0;
      if (coeffOfVariation < 0.05) {
        score = 85; // Suspiciously uniform — likely automated
      } else if (coeffOfVariation > 1.5) {
        score = 70; // Erratic — possible injection attack
      } else if (coeffOfVariation < 0.15) {
        score = 40; // Somewhat uniform
      }

      factors.push({
        name: "keystroke_uniformity",
        category: "biometric",
        score,
        weight: 0.15,
        description:
          score > 60
            ? "Keystroke timing is suspiciously uniform, suggesting automated input"
            : "Keystroke timing is within normal human variance",
        evidence: {
          coeffOfVariation,
          dwellMean,
          dwellStdDev,
          sampleCount: bio.keystrokeDwellTimes.length,
        },
      });
    }

    // Mouse movement naturalness
    if (bio.mouseVelocities && bio.mouseVelocities.length > 10) {
      const velocityStdDev = this.standardDeviation(bio.mouseVelocities);
      const hasNaturalAcceleration = bio.mouseAccelerations
        ? bio.mouseAccelerations.some((a) => Math.abs(a) > 0.1)
        : true;
      const hasCurvature = bio.mouseCurvatures
        ? this.mean(bio.mouseCurvatures) > 0.01
        : true;

      let score = 0;
      if (velocityStdDev < 0.5 && !hasNaturalAcceleration) {
        score = 80; // Linear, constant-speed movement — bot-like
      } else if (!hasCurvature) {
        score = 60; // Perfectly straight paths
      }

      factors.push({
        name: "mouse_naturalness",
        category: "biometric",
        score,
        weight: 0.12,
        description:
          score > 50
            ? "Mouse movement lacks natural human characteristics (curvature, acceleration jitter)"
            : "Mouse movement exhibits natural human patterns",
        evidence: { velocityStdDev, hasNaturalAcceleration, hasCurvature },
      });
    }

    // Touch pressure analysis (mobile)
    if (bio.touchPressures && bio.touchPressures.length > 3) {
      const pressureVariance = this.variance(bio.touchPressures);
      const avgPressure = this.mean(bio.touchPressures);

      let score = 0;
      if (pressureVariance < 0.001 && avgPressure > 0) {
        score = 75; // Constant pressure — emulated touch
      } else if (avgPressure === 0) {
        score = 90; // Zero pressure — programmatic touch events
      }

      factors.push({
        name: "touch_pressure_analysis",
        category: "biometric",
        score,
        weight: 0.1,
        description:
          score > 50
            ? "Touch pressure pattern is inconsistent with physical device interaction"
            : "Touch pressure patterns are consistent with genuine device use",
        evidence: {
          pressureVariance,
          avgPressure,
          sampleCount: bio.touchPressures.length,
        },
      });
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Device fingerprint anomaly detection
  // -------------------------------------------------------------------------
  private async analyzeDeviceFingerprint(
    context: CredentialUsageContext,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];
    const fp = context.deviceFingerprint;
    const identityId = context.identityId;

    // Compute fingerprint hash
    const fpHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          userAgent: fp.userAgent,
          screenResolution: fp.screenResolution,
          canvasHash: fp.canvasHash,
          webglHash: fp.webglHash,
          audioContextHash: fp.audioContextHash,
          platform: fp.platform,
        }),
      )
      .digest("hex");

    // Check if this device is known for this identity
    const knownDevices = this.knownDevices.get(identityId) ?? [];
    const isKnownDevice = knownDevices.includes(fpHash);

    if (!isKnownDevice) {
      // Check how many identities share this device fingerprint
      const cachedSharedCount = await redis.get(`device:shared:${fpHash}`);
      const sharedCount = cachedSharedCount
        ? parseInt(cachedSharedCount, 10)
        : 0;

      let score = 25; // New device has baseline risk
      if (sharedCount > 5) {
        score = 85; // Many identities on same device — credential farming
      } else if (sharedCount > 2) {
        score = 60; // Multiple identities — suspicious but could be shared device
      }

      factors.push({
        name: "unknown_device",
        category: "device",
        score,
        weight: 0.18,
        description:
          sharedCount > 5
            ? `Device fingerprint is shared across ${sharedCount} identities — potential credential farming`
            : sharedCount > 2
              ? `Device is associated with ${sharedCount} identities`
              : "First use from this device — additional verification recommended",
        evidence: { fpHash: fpHash.slice(0, 16), isKnownDevice, sharedCount },
      });

      // Register the device
      knownDevices.push(fpHash);
      if (knownDevices.length > 20) knownDevices.shift(); // keep last 20
      this.knownDevices.set(identityId, knownDevices);
    }

    // Check for fingerprint spoofing indicators
    const spoofingIndicators: string[] = [];

    // Mismatch: touch support claimed but desktop platform
    if (
      fp.touchSupport &&
      fp.platform.toLowerCase().includes("win") &&
      !fp.userAgent.toLowerCase().includes("mobile")
    ) {
      spoofingIndicators.push("touch_desktop_mismatch");
    }

    // Mismatch: very low device memory on claimed desktop
    if (fp.deviceMemory < 2 && !fp.userAgent.toLowerCase().includes("mobile")) {
      spoofingIndicators.push("low_memory_desktop");
    }

    // Mismatch: zero hardware concurrency
    if (fp.hardwareConcurrency === 0) {
      spoofingIndicators.push("zero_cpu_cores");
    }

    if (spoofingIndicators.length > 0) {
      factors.push({
        name: "fingerprint_spoofing",
        category: "device",
        score: Math.min(95, 30 + spoofingIndicators.length * 25),
        weight: 0.2,
        description: `Device fingerprint shows ${spoofingIndicators.length} spoofing indicator(s): ${spoofingIndicators.join(", ")}`,
        evidence: { indicators: spoofingIndicators },
      });
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Credential usage pattern analysis
  // -------------------------------------------------------------------------
  private async analyzeUsagePatterns(
    context: CredentialUsageContext,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];
    const hour = context.timestamp.getUTCHours();
    const identityId = context.identityId;

    // Fetch historical usage hours from cache
    const historyKey = `usage:hours:${identityId}`;
    const cachedHistory = await redis.get(historyKey);
    const hourHistory: number[] = cachedHistory
      ? JSON.parse(cachedHistory)
      : [];

    if (hourHistory.length > 10) {
      const meanHour = this.mean(hourHistory);
      const stdDevHour = this.standardDeviation(hourHistory);

      // Check if current hour is anomalous (> 2 std devs from mean)
      const zScore = Math.abs(hour - meanHour) / (stdDevHour || 1);

      if (zScore > 3) {
        factors.push({
          name: "unusual_time_of_day",
          category: "pattern",
          score: 55,
          weight: 0.08,
          description: `Activity at ${hour}:00 UTC is highly unusual for this identity (z-score: ${zScore.toFixed(1)})`,
          evidence: { hour, meanHour, stdDevHour, zScore },
        });
      } else if (zScore > 2) {
        factors.push({
          name: "unusual_time_of_day",
          category: "pattern",
          score: 30,
          weight: 0.08,
          description: `Activity at ${hour}:00 UTC is somewhat unusual for this identity`,
          evidence: { hour, meanHour, stdDevHour, zScore },
        });
      }
    }

    // Record this hour
    hourHistory.push(hour);
    if (hourHistory.length > 500)
      hourHistory.splice(0, hourHistory.length - 500);
    await redis.set(historyKey, JSON.stringify(hourHistory), "EX", 90 * 86400);

    // Check action type frequency anomalies
    const actionCountKey = `usage:actions:${identityId}:${context.actionType}`;
    const todayKey = `${actionCountKey}:${context.timestamp.toISOString().slice(0, 10)}`;
    const dailyCount = await redis.incr(todayKey);
    if (dailyCount === 1) await redis.expire(todayKey, 172800); // 2-day TTL

    const actionThresholds: Record<string, number> = {
      present: 50,
      verify: 100,
      issue: 20,
      revoke: 5,
      delegate: 10,
    };

    const threshold = actionThresholds[context.actionType] ?? 50;
    if (dailyCount > threshold) {
      const ratio = dailyCount / threshold;
      factors.push({
        name: "high_action_frequency",
        category: "pattern",
        score: Math.min(90, Math.round(40 + ratio * 15)),
        weight: 0.12,
        description: `${context.actionType} action performed ${dailyCount} times today (threshold: ${threshold})`,
        evidence: {
          actionType: context.actionType,
          dailyCount,
          threshold,
          ratio,
        },
      });
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Velocity checks
  // -------------------------------------------------------------------------
  private async performVelocityChecks(
    context: CredentialUsageContext,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];
    const identityId = context.identityId;
    const now = Date.now();

    // Track verifications per identity in sliding windows
    const windowConfigs = [
      { name: "1min", windowMs: 60_000, maxCount: 10 },
      { name: "5min", windowMs: 300_000, maxCount: 30 },
      { name: "1hour", windowMs: 3_600_000, maxCount: 100 },
    ];

    for (const config of windowConfigs) {
      const key = `velocity:${identityId}:${config.name}`;
      let window = this.velocityWindows.get(key);

      if (!window) {
        window = { timestamps: [], windowMs: config.windowMs };
        this.velocityWindows.set(key, window);
      }

      // Prune expired timestamps
      window.timestamps = window.timestamps.filter(
        (t) => now - t < config.windowMs,
      );
      window.timestamps.push(now);

      if (window.timestamps.length > config.maxCount) {
        const ratio = window.timestamps.length / config.maxCount;
        factors.push({
          name: `velocity_${config.name}`,
          category: "velocity",
          score: Math.min(95, Math.round(50 + ratio * 20)),
          weight:
            config.name === "1min" ? 0.2 : config.name === "5min" ? 0.15 : 0.1,
          description: `${window.timestamps.length} actions in the last ${config.name} (limit: ${config.maxCount}) — possible automated abuse`,
          evidence: {
            count: window.timestamps.length,
            window: config.name,
            maxAllowed: config.maxCount,
            ratio,
          },
        });
      }
    }

    // Check for burst pattern (many requests with very short intervals)
    const recentKey = `velocity:${identityId}:recent`;
    const recentWindow = this.velocityWindows.get(recentKey) ?? {
      timestamps: [],
      windowMs: 10_000,
    };
    recentWindow.timestamps = recentWindow.timestamps.filter(
      (t) => now - t < 10_000,
    );
    recentWindow.timestamps.push(now);
    this.velocityWindows.set(recentKey, recentWindow);

    if (recentWindow.timestamps.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < recentWindow.timestamps.length; i++) {
        intervals.push(
          recentWindow.timestamps[i] - recentWindow.timestamps[i - 1],
        );
      }

      const intervalStdDev = this.standardDeviation(intervals);
      const meanInterval = this.mean(intervals);

      // Machine-gun pattern: very regular, very fast intervals
      if (meanInterval < 500 && intervalStdDev < 50) {
        factors.push({
          name: "burst_pattern_detected",
          category: "velocity",
          score: 90,
          weight: 0.22,
          description: `Burst of ${recentWindow.timestamps.length} requests with ${meanInterval.toFixed(0)}ms mean interval — machine-like regularity`,
          evidence: {
            meanIntervalMs: meanInterval,
            intervalStdDev,
            requestCount: recentWindow.timestamps.length,
          },
        });
      }
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Cross-credential correlation (synthetic identity detection)
  // -------------------------------------------------------------------------
  private async analyzeCrossCredentialCorrelation(
    context: CredentialUsageContext,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];
    const identityId = context.identityId;

    // Check if multiple credentials from different issuers share suspicious patterns
    try {
      const credentials = await prisma.credential.findMany({
        where: { subjectId: identityId, status: "ACTIVE" },
        select: {
          id: true,
          credentialType: true,
          issuerId: true,
          issuedAt: true,
          claims: true,
        },
        take: 50,
      });

      if (credentials.length > 1) {
        // Check for temporal clustering: all credentials issued within a very short window
        const issuanceTimes = credentials.map((c) =>
          new Date(c.issuedAt).getTime(),
        );
        issuanceTimes.sort((a, b) => a - b);

        const timeSpanHours =
          (issuanceTimes[issuanceTimes.length - 1] - issuanceTimes[0]) /
          3_600_000;
        if (credentials.length > 3 && timeSpanHours < 2) {
          factors.push({
            name: "credential_temporal_clustering",
            category: "correlation",
            score: 75,
            weight: 0.15,
            description: `${credentials.length} credentials issued within ${timeSpanHours.toFixed(1)} hours — possible synthetic identity`,
            evidence: {
              credentialCount: credentials.length,
              timeSpanHours,
              issuerIds: [...new Set(credentials.map((c) => c.issuerId))],
            },
          });
        }

        // Check for issuer diversity anomaly: too many unique issuers relative to credential count
        const uniqueIssuers = new Set(credentials.map((c) => c.issuerId));
        const issuerRatio = uniqueIssuers.size / credentials.length;

        if (credentials.length > 5 && issuerRatio > 0.9) {
          factors.push({
            name: "excessive_issuer_diversity",
            category: "correlation",
            score: 50,
            weight: 0.1,
            description: `${uniqueIssuers.size} different issuers for ${credentials.length} credentials — unusual diversity pattern`,
            evidence: {
              uniqueIssuers: uniqueIssuers.size,
              credentialCount: credentials.length,
              issuerRatio,
            },
          });
        }
      }
    } catch (err) {
      logger.warn("cross_credential_analysis_error", {
        identityId,
        error: (err as Error).message,
      });
    }

    // Check if device fingerprint appears across multiple identities
    const fpHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(context.deviceFingerprint))
      .digest("hex")
      .slice(0, 32);

    const deviceIdentitiesKey = `device:identities:${fpHash}`;
    await redis.sadd(deviceIdentitiesKey, identityId);
    await redis.expire(deviceIdentitiesKey, 30 * 86400);
    const deviceIdentityCount = await redis.scard(deviceIdentitiesKey);

    if (deviceIdentityCount > 3) {
      factors.push({
        name: "shared_device_identity_cluster",
        category: "correlation",
        score: Math.min(90, 40 + (deviceIdentityCount - 3) * 15),
        weight: 0.18,
        description: `${deviceIdentityCount} distinct identities detected on this device — potential identity farm`,
        evidence: { deviceIdentityCount, fpHashPrefix: fpHash.slice(0, 8) },
      });
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Geolocation analysis
  // -------------------------------------------------------------------------
  private async analyzeGeolocation(
    context: CredentialUsageContext,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];
    const geo = context.geolocation!;
    const identityId = context.identityId;

    // Fetch last known location
    const lastLocationKey = `geo:last:${identityId}`;
    const cachedLocation = await redis.get(lastLocationKey);

    if (cachedLocation) {
      const lastLocation = JSON.parse(cachedLocation) as {
        lat: number;
        lon: number;
        timestamp: number;
      };

      const distanceKm = this.haversineDistance(
        lastLocation.lat,
        lastLocation.lon,
        geo.lat,
        geo.lon,
      );
      const timeDiffHours = (Date.now() - lastLocation.timestamp) / 3_600_000;

      if (timeDiffHours > 0) {
        const impliedSpeedKmh = distanceKm / timeDiffHours;

        // Impossible travel: faster than commercial aviation
        if (impliedSpeedKmh > 1000 && distanceKm > 500) {
          factors.push({
            name: "impossible_travel",
            category: "geolocation",
            score: 90,
            weight: 0.25,
            description: `Location changed ${distanceKm.toFixed(0)}km in ${timeDiffHours.toFixed(1)}h (implied speed: ${impliedSpeedKmh.toFixed(0)} km/h) — impossible travel detected`,
            evidence: {
              distanceKm,
              timeDiffHours,
              impliedSpeedKmh,
              from: { lat: lastLocation.lat, lon: lastLocation.lon },
              to: { lat: geo.lat, lon: geo.lon },
            },
          });
        } else if (impliedSpeedKmh > 500 && distanceKm > 200) {
          factors.push({
            name: "suspicious_travel",
            category: "geolocation",
            score: 55,
            weight: 0.15,
            description: `Rapid location change: ${distanceKm.toFixed(0)}km in ${timeDiffHours.toFixed(1)}h`,
            evidence: { distanceKm, timeDiffHours, impliedSpeedKmh },
          });
        }
      }
    }

    // Update last location
    await redis.set(
      lastLocationKey,
      JSON.stringify({
        lat: geo.lat,
        lon: geo.lon,
        timestamp: Date.now(),
      }),
      "EX",
      30 * 86400,
    );

    return factors;
  }

  // -------------------------------------------------------------------------
  // Feature vector construction for neural network
  // -------------------------------------------------------------------------
  private buildFeatureVector(
    factors: RiskFactor[],
    context: CredentialUsageContext,
  ): number[] {
    // 18-dimensional feature vector
    const getFactorScore = (name: string): number => {
      const f = factors.find((x) => x.name === name);
      return f ? f.score / 100 : 0;
    };

    return [
      // Biometric features (0-2)
      getFactorScore("keystroke_uniformity"),
      getFactorScore("mouse_naturalness"),
      getFactorScore("touch_pressure_analysis"),

      // Device features (3-5)
      getFactorScore("unknown_device"),
      getFactorScore("fingerprint_spoofing"),
      factors.filter((f) => f.category === "device").length > 0 ? 1 : 0,

      // Velocity features (6-9)
      getFactorScore("velocity_1min"),
      getFactorScore("velocity_5min"),
      getFactorScore("velocity_1hour"),
      getFactorScore("burst_pattern_detected"),

      // Pattern features (10-12)
      getFactorScore("unusual_time_of_day"),
      getFactorScore("high_action_frequency"),
      context.actionType === "revoke" || context.actionType === "delegate"
        ? 0.6
        : 0.2,

      // Correlation features (13-15)
      getFactorScore("credential_temporal_clustering"),
      getFactorScore("excessive_issuer_diversity"),
      getFactorScore("shared_device_identity_cluster"),

      // Geolocation features (16-17)
      getFactorScore("impossible_travel"),
      getFactorScore("suspicious_travel"),
    ];
  }

  // -------------------------------------------------------------------------
  // Neural network inference (with optional TEE)
  // -------------------------------------------------------------------------
  private async runModelInference(
    featureVector: number[],
    identityId: string,
  ): Promise<number[]> {
    // In production, model inference runs inside a TEE enclave for:
    // 1. Protecting the model weights from extraction
    // 2. Providing attestation that the correct model was used
    // 3. Ensuring the feature vector was not tampered with

    const output = this.model.predict(featureVector);

    logger.debug("model_inference_complete", {
      identityId,
      featureVectorNorm: Math.sqrt(
        featureVector.reduce((s, v) => s + v * v, 0),
      ).toFixed(4),
      output: output.map((v) => v.toFixed(4)),
      classes: ["allow", "challenge", "block", "review"],
    });

    return output; // [P(allow), P(challenge), P(block), P(review)]
  }

  // -------------------------------------------------------------------------
  // Composite risk score
  // -------------------------------------------------------------------------
  private computeCompositeScore(
    factors: RiskFactor[],
    modelOutput: number[],
  ): number {
    // Weighted factor aggregation
    let weightedSum = 0;
    let totalWeight = 0;

    for (const factor of factors) {
      weightedSum += factor.score * factor.weight;
      totalWeight += factor.weight;
    }

    const factorScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Model-derived risk (complement of allow probability)
    const modelRisk = (1 - modelOutput[0]) * 100;

    // Blend: 60% factor-based, 40% model-based
    const blendedScore = factorScore * 0.6 + modelRisk * 0.4;

    // Clamp to [0, 100]
    return Math.round(Math.max(0, Math.min(100, blendedScore)));
  }

  // -------------------------------------------------------------------------
  // Severity classification
  // -------------------------------------------------------------------------
  private classifySeverity(score: number): FraudSeverity {
    if (score >= 85) return "critical";
    if (score >= 65) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  // -------------------------------------------------------------------------
  // Decision engine
  // -------------------------------------------------------------------------
  private makeDecision(
    modelOutput: number[],
    overallScore: number,
  ): "allow" | "challenge" | "block" | "review" {
    // Hard block threshold
    if (overallScore >= 90) return "block";

    // Use model output class probabilities
    const maxProb = Math.max(...modelOutput);
    const maxIdx = modelOutput.indexOf(maxProb);
    const decisions: Array<"allow" | "challenge" | "block" | "review"> = [
      "allow",
      "challenge",
      "block",
      "review",
    ];

    // Require minimum confidence for block decisions
    if (maxIdx === 2 && maxProb < 0.7) {
      return "review"; // Not confident enough to auto-block
    }

    // Override allow if score is elevated
    if (maxIdx === 0 && overallScore > 50) {
      return "challenge";
    }

    return decisions[maxIdx];
  }

  // -------------------------------------------------------------------------
  // Explainable AI — human-readable explanations
  // -------------------------------------------------------------------------
  private generateExplanations(
    factors: RiskFactor[],
    overallScore: number,
    decision: string,
  ): string[] {
    const explanations: string[] = [];

    // Sort factors by weighted impact (score * weight), descending
    const sorted = [...factors].sort(
      (a, b) => b.score * b.weight - a.score * a.weight,
    );

    // Top contributors explanation
    const topFactors = sorted.filter((f) => f.score > 30).slice(0, 5);
    if (topFactors.length > 0) {
      explanations.push(
        `Risk score ${overallScore}/100 driven by: ${topFactors.map((f) => f.description).join("; ")}.`,
      );
    } else {
      explanations.push(
        `Risk score ${overallScore}/100 — no significant risk factors detected.`,
      );
    }

    // Decision explanation
    const decisionMap: Record<string, string> = {
      allow: "Transaction is permitted to proceed normally.",
      challenge:
        "Additional identity verification is required before proceeding.",
      block:
        "Transaction has been automatically blocked due to high fraud risk.",
      review:
        "Transaction has been queued for manual review by a compliance officer.",
    };
    explanations.push(decisionMap[decision] ?? `Decision: ${decision}`);

    // Category-level summaries
    const categories = new Map<string, RiskFactor[]>();
    for (const f of factors) {
      const existing = categories.get(f.category) ?? [];
      existing.push(f);
      categories.set(f.category, existing);
    }

    for (const [category, categoryFactors] of categories) {
      const maxScore = Math.max(...categoryFactors.map((f) => f.score));
      if (maxScore > 50) {
        explanations.push(
          `${category.charAt(0).toUpperCase() + category.slice(1)} analysis: elevated risk (peak score: ${maxScore}/100).`,
        );
      }
    }

    return explanations;
  }

  // -------------------------------------------------------------------------
  // Persistence & alerting
  // -------------------------------------------------------------------------
  private async persistAssessment(assessment: FraudAssessment): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          identityId: assessment.identityId,
          action: "FRAUD_ASSESSMENT" as any,
          resourceType: "fraud_assessment",
          resourceId: assessment.assessmentId,
          details: {
            score: assessment.overallScore,
            severity: assessment.severity,
            decision: assessment.decision,
            factorCount: assessment.factors.length,
            modelVersion: assessment.modelVersion,
            processingTimeMs: assessment.processingTimeMs,
          },
        },
      });

      // Cache the assessment for quick lookups
      await redis.set(
        `fraud:assessment:${assessment.assessmentId}`,
        JSON.stringify(assessment),
        "EX",
        7 * 86400,
      );

      // Update identity risk profile
      await redis.set(
        `fraud:identity:${assessment.identityId}:latest`,
        JSON.stringify({
          score: assessment.overallScore,
          severity: assessment.severity,
          decision: assessment.decision,
          timestamp: assessment.timestamp,
        }),
        "EX",
        24 * 3600,
      );
    } catch (err) {
      logger.error("fraud_assessment_persist_error", {
        assessmentId: assessment.assessmentId,
        error: (err as Error).message,
      });
    }
  }

  private async createFraudAlert(
    assessment: FraudAssessment,
  ): Promise<FraudAlert> {
    const alert: FraudAlert = {
      alertId: `alert-${crypto.randomUUID()}`,
      assessmentId: assessment.assessmentId,
      identityId: assessment.identityId,
      severity: assessment.severity,
      title: `${assessment.severity.toUpperCase()} fraud risk detected for identity ${assessment.identityId.slice(0, 8)}...`,
      description: assessment.explanations.join(" "),
      status: "active",
      riskScore: assessment.overallScore,
      factors: assessment.factors.filter((f) => f.score > 40),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.alerts.set(alert.alertId, alert);

    await redis.lpush("fraud:alerts:active", JSON.stringify(alert));
    await redis.ltrim("fraud:alerts:active", 0, 999); // keep last 1000

    logger.warn("fraud_alert_created", {
      alertId: alert.alertId,
      assessmentId: assessment.assessmentId,
      identityId: assessment.identityId,
      severity: alert.severity,
      riskScore: alert.riskScore,
    });

    return alert;
  }

  // -------------------------------------------------------------------------
  // Alert management
  // -------------------------------------------------------------------------
  async getActiveAlerts(severity?: FraudSeverity): Promise<FraudAlert[]> {
    let alerts = Array.from(this.alerts.values()).filter(
      (a) => a.status === "active" || a.status === "investigating",
    );

    if (severity) {
      alerts = alerts.filter((a) => a.severity === severity);
    }

    return alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async resolveAlert(
    alertId: string,
    resolvedBy: string,
    resolution: string,
    isFalsePositive: boolean,
  ): Promise<FraudAlert> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new FraudDetectionError("Alert not found", "ALERT_NOT_FOUND", 404);
    }

    alert.status = isFalsePositive ? "false_positive" : "resolved";
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution;
    alert.updatedAt = new Date();
    this.alerts.set(alertId, alert);

    await prisma.auditLog.create({
      data: {
        identityId: alert.identityId,
        action: "FRAUD_ALERT_RESOLVED" as any,
        resourceType: "fraud_alert",
        resourceId: alertId,
        details: {
          resolution,
          isFalsePositive,
          resolvedBy,
          originalSeverity: alert.severity,
          riskScore: alert.riskScore,
        },
      },
    });

    logger.info("fraud_alert_resolved", {
      alertId,
      resolvedBy,
      isFalsePositive,
      severity: alert.severity,
    });

    return alert;
  }

  // -------------------------------------------------------------------------
  // Utility methods
  // -------------------------------------------------------------------------
  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private variance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = this.mean(arr);
    return arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  }

  private standardDeviation(arr: number[]): number {
    return Math.sqrt(this.variance(arr));
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
export class FraudDetectionError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "FraudDetectionError";
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const fraudDetectionService = new FraudDetectionService();
