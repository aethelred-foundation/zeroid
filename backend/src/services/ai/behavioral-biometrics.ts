import crypto from 'crypto';
import { prisma, logger, redis } from '../../index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeystrokeEvent {
  key: string;
  downTimestamp: number;   // ms since epoch
  upTimestamp: number;
  pressure?: number;       // 0-1 (touch keyboards)
}

export interface MouseEvent {
  x: number;
  y: number;
  timestamp: number;
  type: 'move' | 'click' | 'scroll';
  button?: number;
  scrollDelta?: number;
}

export interface TouchEvent {
  x: number;
  y: number;
  timestamp: number;
  pressure: number;        // 0-1
  radiusX: number;
  radiusY: number;
  type: 'start' | 'move' | 'end';
}

export interface BiometricSession {
  sessionId: string;
  identityId: string;
  keystrokes: KeystrokeEvent[];
  mouseEvents: MouseEvent[];
  touchEvents: TouchEvent[];
  startedAt: Date;
  userAgent: string;
  screenSize: { width: number; height: number };
}

export interface BiometricTemplate {
  templateId: string;
  identityId: string;
  keystrokeProfile: KeystrokeProfile;
  mouseProfile: MouseProfile;
  touchProfile: TouchProfile;
  sampleCount: number;
  createdAt: Date;
  updatedAt: Date;
  confidence: number;       // 0-1, increases with more samples
}

interface KeystrokeProfile {
  meanDwellTime: number;
  stdDevDwellTime: number;
  meanFlightTime: number;
  stdDevFlightTime: number;
  digramTimings: Map<string, { mean: number; stdDev: number }>;
  typingSpeed: number;       // chars per minute
  errorRate: number;         // fraction of backspaces
  rhythmSignature: number[]; // FFT-derived rhythm features
}

interface MouseProfile {
  meanVelocity: number;
  stdDevVelocity: number;
  meanAcceleration: number;
  meanCurvature: number;
  clickDwellMean: number;
  straightnessIndex: number; // 0=perfectly straight, 1=very curved
  movementAngleDistribution: number[]; // histogram of movement angles (8 bins)
}

interface TouchProfile {
  meanPressure: number;
  stdDevPressure: number;
  meanContactArea: number;
  swipeVelocityMean: number;
  tapDurationMean: number;
  gestureComplexity: number; // 0-1
}

export interface BiometricMatchResult {
  matchId: string;
  identityId: string;
  sessionId: string;
  overallScore: number;     // 0-1 (1 = perfect match)
  keystrokeScore: number;
  mouseScore: number;
  touchScore: number;
  isLive: boolean;          // liveness detection result
  isBotLikely: boolean;
  confidence: number;
  verdict: 'match' | 'partial_match' | 'mismatch' | 'insufficient_data';
  details: string[];
  timestamp: Date;
}

export interface ContinuousAuthScore {
  identityId: string;
  sessionId: string;
  score: number;            // 0-1, rolling authentication confidence
  windowSize: number;       // events in current window
  alerts: string[];
  lastUpdated: Date;
}

// ---------------------------------------------------------------------------
// Behavioral Biometrics Service
// ---------------------------------------------------------------------------

export class BehavioralBiometricsService {
  private templates: Map<string, BiometricTemplate> = new Map();
  private continuousScores: Map<string, ContinuousAuthScore> = new Map();

  // -------------------------------------------------------------------------
  // Keystroke dynamics analysis
  // -------------------------------------------------------------------------
  analyzeKeystrokes(events: KeystrokeEvent[]): {
    dwellTimes: number[];
    flightTimes: number[];
    digramTimings: Map<string, number[]>;
    typingSpeed: number;
    errorRate: number;
    rhythmFeatures: number[];
    botProbability: number;
  } {
    if (events.length < 5) {
      return {
        dwellTimes: [], flightTimes: [], digramTimings: new Map(),
        typingSpeed: 0, errorRate: 0, rhythmFeatures: [], botProbability: 0.5,
      };
    }

    // Dwell times (key-down to key-up for same key)
    const dwellTimes = events
      .filter((e) => e.upTimestamp > e.downTimestamp)
      .map((e) => e.upTimestamp - e.downTimestamp);

    // Flight times (key-up to next key-down)
    const flightTimes: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const flight = events[i].downTimestamp - events[i - 1].upTimestamp;
      if (flight > 0 && flight < 5000) {
        flightTimes.push(flight);
      }
    }

    // Digram (key-pair) timing patterns
    const digramTimings = new Map<string, number[]>();
    for (let i = 1; i < events.length; i++) {
      const digram = `${events[i - 1].key}-${events[i].key}`;
      const timing = events[i].downTimestamp - events[i - 1].downTimestamp;
      if (timing > 0 && timing < 5000) {
        const existing = digramTimings.get(digram) ?? [];
        existing.push(timing);
        digramTimings.set(digram, existing);
      }
    }

    // Typing speed (chars per minute)
    const totalTimeMs = events[events.length - 1].upTimestamp - events[0].downTimestamp;
    const typingSpeed = totalTimeMs > 0 ? (events.length / (totalTimeMs / 60000)) : 0;

    // Error rate (backspace/delete proportion)
    const errorKeys = events.filter((e) =>
      e.key === 'Backspace' || e.key === 'Delete',
    ).length;
    const errorRate = events.length > 0 ? errorKeys / events.length : 0;

    // Rhythm features via simplified spectral analysis
    const rhythmFeatures = this.extractRhythmFeatures(dwellTimes.concat(flightTimes));

    // Bot probability based on timing uniformity
    const dwellCV = this.coefficientOfVariation(dwellTimes);
    const flightCV = this.coefficientOfVariation(flightTimes);

    let botProbability = 0;
    if (dwellCV < 0.05 && flightCV < 0.05) {
      botProbability = 0.95; // Near-zero variance = machine
    } else if (dwellCV < 0.1 || flightCV < 0.1) {
      botProbability = 0.6;
    } else if (dwellCV > 1.5 || flightCV > 1.5) {
      botProbability = 0.4; // Too erratic = injection
    } else {
      botProbability = 0.05; // Normal human variance
    }

    return {
      dwellTimes, flightTimes, digramTimings,
      typingSpeed, errorRate, rhythmFeatures, botProbability,
    };
  }

  // -------------------------------------------------------------------------
  // Mouse movement profiling
  // -------------------------------------------------------------------------
  analyzeMouseMovements(events: MouseEvent[]): {
    velocities: number[];
    accelerations: number[];
    curvatures: number[];
    straightnessIndex: number;
    angleDistribution: number[];
    botProbability: number;
  } {
    const moveEvents = events.filter((e) => e.type === 'move');

    if (moveEvents.length < 10) {
      return {
        velocities: [], accelerations: [], curvatures: [],
        straightnessIndex: 0, angleDistribution: new Array(8).fill(0),
        botProbability: 0.5,
      };
    }

    const velocities: number[] = [];
    const accelerations: number[] = [];
    const curvatures: number[] = [];
    const angles: number[] = [];

    for (let i = 1; i < moveEvents.length; i++) {
      const dx = moveEvents[i].x - moveEvents[i - 1].x;
      const dy = moveEvents[i].y - moveEvents[i - 1].y;
      const dt = (moveEvents[i].timestamp - moveEvents[i - 1].timestamp) / 1000;

      if (dt <= 0) continue;

      const distance = Math.sqrt(dx * dx + dy * dy);
      const velocity = distance / dt;
      velocities.push(velocity);

      // Angle of movement (8 directional bins)
      const angle = Math.atan2(dy, dx);
      angles.push(angle);

      if (velocities.length >= 2) {
        const prevVelocity = velocities[velocities.length - 2];
        accelerations.push((velocity - prevVelocity) / dt);
      }
    }

    // Curvature: change in angle per unit distance
    for (let i = 2; i < moveEvents.length; i++) {
      const dx1 = moveEvents[i - 1].x - moveEvents[i - 2].x;
      const dy1 = moveEvents[i - 1].y - moveEvents[i - 2].y;
      const dx2 = moveEvents[i].x - moveEvents[i - 1].x;
      const dy2 = moveEvents[i].y - moveEvents[i - 1].y;

      const angle1 = Math.atan2(dy1, dx1);
      const angle2 = Math.atan2(dy2, dx2);
      let angleDiff = angle2 - angle1;
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      const segmentLength = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (segmentLength > 0) {
        curvatures.push(Math.abs(angleDiff) / segmentLength);
      }
    }

    // Straightness index: ratio of actual path length to straight-line distance
    let totalPath = 0;
    for (let i = 1; i < moveEvents.length; i++) {
      const dx = moveEvents[i].x - moveEvents[i - 1].x;
      const dy = moveEvents[i].y - moveEvents[i - 1].y;
      totalPath += Math.sqrt(dx * dx + dy * dy);
    }

    const directDistance = Math.sqrt(
      (moveEvents[moveEvents.length - 1].x - moveEvents[0].x) ** 2 +
      (moveEvents[moveEvents.length - 1].y - moveEvents[0].y) ** 2,
    );
    const straightnessIndex = directDistance > 0 ? 1 - (directDistance / totalPath) : 0;

    // Angle distribution (8 bins)
    const angleDistribution = new Array(8).fill(0);
    for (const angle of angles) {
      const bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8;
      angleDistribution[bin]++;
    }
    const totalAngles = angles.length || 1;
    for (let i = 0; i < 8; i++) {
      angleDistribution[i] /= totalAngles;
    }

    // Bot detection
    const velocityCV = this.coefficientOfVariation(velocities);
    const hasAccelerationJitter = accelerations.some((a) => Math.abs(a) > 50);
    let botProbability = 0;

    if (velocityCV < 0.05 && !hasAccelerationJitter) {
      botProbability = 0.9; // Constant velocity, no jitter
    } else if (straightnessIndex < 0.01) {
      botProbability = 0.7; // Perfectly straight paths
    } else if (curvatures.length > 0 && this.mean(curvatures) < 0.001) {
      botProbability = 0.6; // No curvature
    } else {
      botProbability = 0.05;
    }

    return {
      velocities, accelerations, curvatures,
      straightnessIndex, angleDistribution, botProbability,
    };
  }

  // -------------------------------------------------------------------------
  // Touch behavior analysis
  // -------------------------------------------------------------------------
  analyzeTouchBehavior(events: TouchEvent[]): {
    pressures: number[];
    contactAreas: number[];
    swipeVelocities: number[];
    tapDurations: number[];
    gestureComplexity: number;
    botProbability: number;
  } {
    if (events.length < 3) {
      return {
        pressures: [], contactAreas: [], swipeVelocities: [],
        tapDurations: [], gestureComplexity: 0, botProbability: 0.5,
      };
    }

    const pressures = events.map((e) => e.pressure);
    const contactAreas = events.map((e) => Math.PI * e.radiusX * e.radiusY);

    // Segment into gestures (start -> end sequences)
    const gestures: TouchEvent[][] = [];
    let currentGesture: TouchEvent[] = [];

    for (const event of events) {
      if (event.type === 'start') {
        if (currentGesture.length > 0) gestures.push(currentGesture);
        currentGesture = [event];
      } else {
        currentGesture.push(event);
        if (event.type === 'end') {
          gestures.push(currentGesture);
          currentGesture = [];
        }
      }
    }
    if (currentGesture.length > 0) gestures.push(currentGesture);

    // Swipe velocities
    const swipeVelocities: number[] = [];
    const tapDurations: number[] = [];

    for (const gesture of gestures) {
      if (gesture.length < 2) continue;

      const first = gesture[0];
      const last = gesture[gesture.length - 1];
      const duration = last.timestamp - first.timestamp;
      const distance = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);

      if (distance > 20 && duration > 0) {
        // Swipe
        swipeVelocities.push(distance / duration * 1000); // px/s
      } else if (duration > 0) {
        // Tap
        tapDurations.push(duration);
      }
    }

    // Gesture complexity (unique gesture types, direction changes)
    const directionChanges = this.countDirectionChanges(events);
    const gestureComplexity = Math.min(1.0, (gestures.length * 0.1 + directionChanges * 0.05));

    // Bot detection
    const pressureCV = this.coefficientOfVariation(pressures.filter((p) => p > 0));
    let botProbability = 0;

    if (pressures.every((p) => p === 0)) {
      botProbability = 0.95; // Programmatic events have zero pressure
    } else if (pressureCV < 0.02) {
      botProbability = 0.8;  // Unnaturally uniform pressure
    } else if (contactAreas.every((a) => a === contactAreas[0])) {
      botProbability = 0.7;  // Identical contact areas
    } else {
      botProbability = 0.05;
    }

    return {
      pressures, contactAreas, swipeVelocities,
      tapDurations, gestureComplexity, botProbability,
    };
  }

  // -------------------------------------------------------------------------
  // Session fingerprinting & template matching
  // -------------------------------------------------------------------------
  async processSession(session: BiometricSession): Promise<BiometricMatchResult> {
    const matchId = `bm-${crypto.randomUUID()}`;

    logger.info('biometric_session_processing', {
      matchId,
      sessionId: session.sessionId,
      identityId: session.identityId,
      keystrokeCount: session.keystrokes.length,
      mouseEventCount: session.mouseEvents.length,
      touchEventCount: session.touchEvents.length,
    });

    // Analyze each modality
    const keystrokeAnalysis = this.analyzeKeystrokes(session.keystrokes);
    const mouseAnalysis = this.analyzeMouseMovements(session.mouseEvents);
    const touchAnalysis = this.analyzeTouchBehavior(session.touchEvents);

    // Get or create template for this identity
    let template = this.templates.get(session.identityId);
    const details: string[] = [];

    let keystrokeScore = 0.5;
    let mouseScore = 0.5;
    let touchScore = 0.5;

    if (template && template.sampleCount >= 3) {
      // Match against existing template
      keystrokeScore = this.matchKeystrokeProfile(keystrokeAnalysis, template.keystrokeProfile);
      mouseScore = this.matchMouseProfile(mouseAnalysis, template.mouseProfile);
      touchScore = this.matchTouchProfile(touchAnalysis, template.touchProfile);

      details.push(`Keystroke match: ${(keystrokeScore * 100).toFixed(1)}%`);
      details.push(`Mouse match: ${(mouseScore * 100).toFixed(1)}%`);
      details.push(`Touch match: ${(touchScore * 100).toFixed(1)}%`);
    } else {
      details.push('Building biometric profile (insufficient samples for matching)');
    }

    // Update template with new session data
    await this.updateTemplate(session.identityId, keystrokeAnalysis, mouseAnalysis, touchAnalysis);

    // Liveness detection
    const isLive = this.detectLiveness(keystrokeAnalysis, mouseAnalysis, touchAnalysis);

    // Combined bot probability (weighted average)
    const combinedBotProb = (
      keystrokeAnalysis.botProbability * 0.4 +
      mouseAnalysis.botProbability * 0.35 +
      touchAnalysis.botProbability * 0.25
    );
    const isBotLikely = combinedBotProb > 0.6;

    if (isBotLikely) {
      details.push(`Bot probability: ${(combinedBotProb * 100).toFixed(1)}% — automated behavior detected`);
    }

    if (!isLive) {
      details.push('Liveness check failed — possible replay or emulation attack');
    }

    // Compute weights based on data availability
    const hasKeystroke = session.keystrokes.length >= 5;
    const hasMouse = session.mouseEvents.length >= 10;
    const hasTouch = session.touchEvents.length >= 3;

    let kWeight = hasKeystroke ? 0.4 : 0;
    let mWeight = hasMouse ? 0.35 : 0;
    let tWeight = hasTouch ? 0.25 : 0;
    const totalWeight = kWeight + mWeight + tWeight;

    if (totalWeight > 0) {
      kWeight /= totalWeight;
      mWeight /= totalWeight;
      tWeight /= totalWeight;
    }

    const overallScore = keystrokeScore * kWeight + mouseScore * mWeight + touchScore * tWeight;
    const confidence = Math.min(1.0, totalWeight * (template?.sampleCount ?? 1) / 5);

    let verdict: BiometricMatchResult['verdict'] = 'insufficient_data';
    if (confidence >= 0.5) {
      if (overallScore >= 0.75) verdict = 'match';
      else if (overallScore >= 0.5) verdict = 'partial_match';
      else verdict = 'mismatch';
    }

    const result: BiometricMatchResult = {
      matchId,
      identityId: session.identityId,
      sessionId: session.sessionId,
      overallScore,
      keystrokeScore,
      mouseScore,
      touchScore,
      isLive,
      isBotLikely,
      confidence,
      verdict,
      details,
      timestamp: new Date(),
    };

    // Persist result
    await this.persistMatchResult(result);

    // Update continuous auth score
    this.updateContinuousAuth(session.identityId, session.sessionId, overallScore, isBotLikely);

    logger.info('biometric_session_processed', {
      matchId,
      identityId: session.identityId,
      overallScore: overallScore.toFixed(3),
      verdict,
      isBotLikely,
      isLive,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Continuous authentication
  // -------------------------------------------------------------------------
  getContinuousAuthScore(identityId: string, sessionId: string): ContinuousAuthScore | null {
    const key = `${identityId}:${sessionId}`;
    return this.continuousScores.get(key) ?? null;
  }

  private updateContinuousAuth(
    identityId: string,
    sessionId: string,
    newScore: number,
    isBotDetected: boolean,
  ): void {
    const key = `${identityId}:${sessionId}`;
    const existing = this.continuousScores.get(key);

    const alerts: string[] = [];

    if (existing) {
      // Exponential moving average with decay
      const alpha = 0.3; // smoothing factor
      const updatedScore = alpha * newScore + (1 - alpha) * existing.score;

      if (updatedScore < existing.score - 0.2) {
        alerts.push('Significant drop in behavioral match — re-authentication recommended');
      }

      if (isBotDetected) {
        alerts.push('Automated behavior detected during continuous authentication');
      }

      this.continuousScores.set(key, {
        identityId,
        sessionId,
        score: updatedScore,
        windowSize: existing.windowSize + 1,
        alerts,
        lastUpdated: new Date(),
      });
    } else {
      this.continuousScores.set(key, {
        identityId,
        sessionId,
        score: newScore,
        windowSize: 1,
        alerts: isBotDetected ? ['Bot behavior detected on initial assessment'] : [],
        lastUpdated: new Date(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Template management
  // -------------------------------------------------------------------------
  private async updateTemplate(
    identityId: string,
    keystroke: ReturnType<typeof this.analyzeKeystrokes>,
    mouse: ReturnType<typeof this.analyzeMouseMovements>,
    touch: ReturnType<typeof this.analyzeTouchBehavior>,
  ): Promise<void> {
    const existing = this.templates.get(identityId);
    const now = new Date();

    if (!existing) {
      // Create new template
      const template: BiometricTemplate = {
        templateId: `bt-${crypto.randomUUID()}`,
        identityId,
        keystrokeProfile: {
          meanDwellTime: this.mean(keystroke.dwellTimes),
          stdDevDwellTime: this.stdDev(keystroke.dwellTimes),
          meanFlightTime: this.mean(keystroke.flightTimes),
          stdDevFlightTime: this.stdDev(keystroke.flightTimes),
          digramTimings: new Map(),
          typingSpeed: keystroke.typingSpeed,
          errorRate: keystroke.errorRate,
          rhythmSignature: keystroke.rhythmFeatures,
        },
        mouseProfile: {
          meanVelocity: this.mean(mouse.velocities),
          stdDevVelocity: this.stdDev(mouse.velocities),
          meanAcceleration: this.mean(mouse.accelerations),
          meanCurvature: this.mean(mouse.curvatures),
          clickDwellMean: 0,
          straightnessIndex: mouse.straightnessIndex,
          movementAngleDistribution: mouse.angleDistribution,
        },
        touchProfile: {
          meanPressure: this.mean(touch.pressures),
          stdDevPressure: this.stdDev(touch.pressures),
          meanContactArea: this.mean(touch.contactAreas),
          swipeVelocityMean: this.mean(touch.swipeVelocities),
          tapDurationMean: this.mean(touch.tapDurations),
          gestureComplexity: touch.gestureComplexity,
        },
        sampleCount: 1,
        createdAt: now,
        updatedAt: now,
        confidence: 0.2,
      };

      this.templates.set(identityId, template);
    } else {
      // Incrementally update template with exponential moving average
      const alpha = Math.min(0.3, 1 / (existing.sampleCount + 1));
      const kp = existing.keystrokeProfile;
      const mp = existing.mouseProfile;
      const tp = existing.touchProfile;

      if (keystroke.dwellTimes.length > 0) {
        kp.meanDwellTime = (1 - alpha) * kp.meanDwellTime + alpha * this.mean(keystroke.dwellTimes);
        kp.stdDevDwellTime = (1 - alpha) * kp.stdDevDwellTime + alpha * this.stdDev(keystroke.dwellTimes);
        kp.meanFlightTime = (1 - alpha) * kp.meanFlightTime + alpha * this.mean(keystroke.flightTimes);
        kp.typingSpeed = (1 - alpha) * kp.typingSpeed + alpha * keystroke.typingSpeed;
      }

      if (mouse.velocities.length > 0) {
        mp.meanVelocity = (1 - alpha) * mp.meanVelocity + alpha * this.mean(mouse.velocities);
        mp.stdDevVelocity = (1 - alpha) * mp.stdDevVelocity + alpha * this.stdDev(mouse.velocities);
        mp.straightnessIndex = (1 - alpha) * mp.straightnessIndex + alpha * mouse.straightnessIndex;
      }

      if (touch.pressures.length > 0) {
        tp.meanPressure = (1 - alpha) * tp.meanPressure + alpha * this.mean(touch.pressures);
        tp.stdDevPressure = (1 - alpha) * tp.stdDevPressure + alpha * this.stdDev(touch.pressures);
      }

      existing.sampleCount++;
      existing.updatedAt = now;
      existing.confidence = Math.min(1.0, existing.sampleCount / 10);
      this.templates.set(identityId, existing);
    }
  }

  // -------------------------------------------------------------------------
  // Profile matching
  // -------------------------------------------------------------------------
  private matchKeystrokeProfile(
    analysis: ReturnType<typeof this.analyzeKeystrokes>,
    profile: KeystrokeProfile,
  ): number {
    if (analysis.dwellTimes.length < 5) return 0.5;

    const scores: number[] = [];

    // Dwell time similarity
    const dwellMean = this.mean(analysis.dwellTimes);
    scores.push(this.gaussianSimilarity(dwellMean, profile.meanDwellTime, profile.stdDevDwellTime * 2 || 30));

    // Flight time similarity
    const flightMean = this.mean(analysis.flightTimes);
    scores.push(this.gaussianSimilarity(flightMean, profile.meanFlightTime, profile.stdDevFlightTime * 2 || 50));

    // Typing speed similarity
    scores.push(this.gaussianSimilarity(analysis.typingSpeed, profile.typingSpeed, profile.typingSpeed * 0.3 || 20));

    // Error rate similarity
    scores.push(this.gaussianSimilarity(analysis.errorRate, profile.errorRate, 0.05));

    return this.mean(scores);
  }

  private matchMouseProfile(
    analysis: ReturnType<typeof this.analyzeMouseMovements>,
    profile: MouseProfile,
  ): number {
    if (analysis.velocities.length < 10) return 0.5;

    const scores: number[] = [];

    scores.push(this.gaussianSimilarity(
      this.mean(analysis.velocities), profile.meanVelocity, profile.stdDevVelocity * 2 || 100,
    ));

    scores.push(this.gaussianSimilarity(
      analysis.straightnessIndex, profile.straightnessIndex, 0.15,
    ));

    // Angle distribution similarity (cosine similarity)
    const cosineSim = this.cosineSimilarity(analysis.angleDistribution, profile.movementAngleDistribution);
    scores.push(cosineSim);

    return this.mean(scores);
  }

  private matchTouchProfile(
    analysis: ReturnType<typeof this.analyzeTouchBehavior>,
    profile: TouchProfile,
  ): number {
    if (analysis.pressures.length < 3) return 0.5;

    const scores: number[] = [];

    scores.push(this.gaussianSimilarity(
      this.mean(analysis.pressures), profile.meanPressure, profile.stdDevPressure * 2 || 0.1,
    ));

    if (analysis.swipeVelocities.length > 0) {
      scores.push(this.gaussianSimilarity(
        this.mean(analysis.swipeVelocities), profile.swipeVelocityMean, profile.swipeVelocityMean * 0.3 || 100,
      ));
    }

    if (analysis.tapDurations.length > 0) {
      scores.push(this.gaussianSimilarity(
        this.mean(analysis.tapDurations), profile.tapDurationMean, profile.tapDurationMean * 0.3 || 50,
      ));
    }

    return this.mean(scores);
  }

  // -------------------------------------------------------------------------
  // Liveness detection
  // -------------------------------------------------------------------------
  private detectLiveness(
    keystroke: ReturnType<typeof this.analyzeKeystrokes>,
    mouse: ReturnType<typeof this.analyzeMouseMovements>,
    touch: ReturnType<typeof this.analyzeTouchBehavior>,
  ): boolean {
    const signals: boolean[] = [];

    // Keystroke liveness: human typing has natural rhythm variation
    if (keystroke.dwellTimes.length >= 5) {
      const cv = this.coefficientOfVariation(keystroke.dwellTimes);
      signals.push(cv > 0.08 && cv < 2.0);
    }

    // Mouse liveness: natural mouse has acceleration jitter
    if (mouse.accelerations.length >= 5) {
      const hasJitter = mouse.accelerations.some((a) => Math.abs(a) > 10);
      const hasCurvature = mouse.curvatures.length > 0 && this.mean(mouse.curvatures) > 0.005;
      signals.push(hasJitter || hasCurvature);
    }

    // Touch liveness: real touches have non-zero, varying pressure
    if (touch.pressures.length >= 3) {
      const hasNonZero = touch.pressures.some((p) => p > 0);
      const hasVariation = this.coefficientOfVariation(touch.pressures.filter((p) => p > 0)) > 0.03;
      signals.push(hasNonZero && hasVariation);
    }

    // Require majority of available signals to pass
    if (signals.length === 0) return true; // no data = benefit of the doubt
    const passCount = signals.filter((s) => s).length;
    return passCount / signals.length >= 0.5;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  private async persistMatchResult(result: BiometricMatchResult): Promise<void> {
    try {
      await redis.set(
        `biometric:match:${result.matchId}`,
        JSON.stringify(result),
        'EX',
        7 * 86400,
      );

      await prisma.auditLog.create({
        data: {
          identityId: result.identityId,
          action: 'BIOMETRIC_ANALYSIS' as any,
          resourceType: 'biometric_match',
          resourceId: result.matchId,
          details: {
            overallScore: result.overallScore,
            verdict: result.verdict,
            isBotLikely: result.isBotLikely,
            isLive: result.isLive,
            confidence: result.confidence,
          },
        },
      });
    } catch (err) {
      logger.error('biometric_persist_error', {
        matchId: result.matchId,
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Utility methods
  // -------------------------------------------------------------------------
  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = this.mean(arr);
    return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1));
  }

  private coefficientOfVariation(arr: number[]): number {
    const m = this.mean(arr);
    if (m === 0) return 0;
    return this.stdDev(arr) / Math.abs(m);
  }

  private gaussianSimilarity(value: number, mean: number, sigma: number): number {
    if (sigma <= 0) sigma = 1;
    return Math.exp(-0.5 * ((value - mean) / sigma) ** 2);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private extractRhythmFeatures(timings: number[]): number[] {
    if (timings.length < 4) return [];
    // Simplified DFT to extract dominant rhythm frequencies
    const N = Math.min(timings.length, 64);
    const features: number[] = [];

    for (let k = 1; k <= Math.min(8, N / 2); k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * k * n) / N;
        real += timings[n] * Math.cos(angle);
        imag += timings[n] * Math.sin(angle);
      }
      features.push(Math.sqrt(real * real + imag * imag) / N);
    }

    return features;
  }

  private countDirectionChanges(events: TouchEvent[]): number {
    const moveEvents = events.filter((e) => e.type === 'move');
    if (moveEvents.length < 3) return 0;

    let changes = 0;
    for (let i = 2; i < moveEvents.length; i++) {
      const dx1 = moveEvents[i - 1].x - moveEvents[i - 2].x;
      const dy1 = moveEvents[i - 1].y - moveEvents[i - 2].y;
      const dx2 = moveEvents[i].x - moveEvents[i - 1].x;
      const dy2 = moveEvents[i].y - moveEvents[i - 1].y;

      // Cross product sign change indicates direction change
      const cross = dx1 * dy2 - dy1 * dx2;
      if (i > 2) {
        const prevDx1 = moveEvents[i - 2].x - moveEvents[i - 3].x;
        const prevDy1 = moveEvents[i - 2].y - moveEvents[i - 3].y;
        const prevCross = prevDx1 * dy1 - prevDy1 * dx1;
        if ((cross > 0 && prevCross < 0) || (cross < 0 && prevCross > 0)) {
          changes++;
        }
      }
    }

    return changes;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const behavioralBiometricsService = new BehavioralBiometricsService();
