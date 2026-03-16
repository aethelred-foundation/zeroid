'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Upload,
  ShieldCheck,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  X,
  Plus,
  Lock,
  Info,
} from 'lucide-react';
import { useCredentials } from '@/hooks/useCredentials';
import { useTEE } from '@/hooks/useTEE';
import type { CredentialSchemaType, DocumentUpload } from '@/types';

interface SchemaOption {
  type: CredentialSchemaType;
  label: string;
  description: string;
  requiredDocuments: string[];
}

const SCHEMA_OPTIONS: SchemaOption[] = [
  {
    type: 'identity',
    label: 'Identity Credential',
    description: 'Proof of identity verified via government-issued documents',
    requiredDocuments: ['Government ID', 'Proof of Address'],
  },
  {
    type: 'accreditation',
    label: 'Accreditation Credential',
    description: 'Professional or institutional accreditation verification',
    requiredDocuments: ['Accreditation Certificate', 'Organization Letter'],
  },
  {
    type: 'kyc',
    label: 'KYC Credential',
    description: 'Know Your Customer compliance verification',
    requiredDocuments: ['Government ID', 'Proof of Address', 'Source of Funds'],
  },
  {
    type: 'education',
    label: 'Education Credential',
    description: 'Educational qualification and degree verification',
    requiredDocuments: ['Degree Certificate', 'Transcript'],
  },
  {
    type: 'employment',
    label: 'Employment Credential',
    description: 'Employment history and position verification',
    requiredDocuments: ['Employment Letter', 'Pay Stub'],
  },
];

type RequestStep = 'select' | 'documents' | 'verify' | 'complete';

export default function CredentialRequest() {
  const [step, setStep] = useState<RequestStep>('select');
  const [selectedSchema, setSelectedSchema] = useState<SchemaOption | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<DocumentUpload[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaDropdownOpen, setSchemaDropdownOpen] = useState(false);

  const { requestCredential } = useCredentials();
  const { verifyInEnclave, enclaveStatus } = useTEE();

  const handleSchemaSelect = useCallback((schema: SchemaOption) => {
    setSelectedSchema(schema);
    setSchemaDropdownOpen(false);
    setUploadedDocs([]);
    setError(null);
  }, []);

  const handleFileUpload = useCallback(
    (documentType: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          setError('File size must be under 10MB');
          return;
        }
        setUploadedDocs((prev) => [
          ...prev.filter((d) => d.documentType !== documentType),
          { documentType, fileName: file.name, file, uploadedAt: Date.now() },
        ]);
        setError(null);
      };
      input.click();
    },
    []
  );

  const removeDocument = useCallback((documentType: string) => {
    setUploadedDocs((prev) => prev.filter((d) => d.documentType !== documentType));
  }, []);

  const handleProceedToDocuments = useCallback(() => {
    if (!selectedSchema) {
      setError('Please select a credential type');
      return;
    }
    setStep('documents');
    setError(null);
  }, [selectedSchema]);

  const handleProceedToVerify = useCallback(() => {
    if (!selectedSchema) return;
    const allUploaded = selectedSchema.requiredDocuments.every((doc) =>
      uploadedDocs.some((u) => u.documentType === doc)
    );
    if (!allUploaded) {
      setError('Please upload all required documents');
      return;
    }
    setStep('verify');
    setError(null);
  }, [selectedSchema, uploadedDocs]);

  const handleSubmit = useCallback(async () => {
    if (!selectedSchema) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await verifyInEnclave(uploadedDocs);
      await requestCredential({
        schemaType: selectedSchema.type,
        documents: uploadedDocs,
      });
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credential request failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedSchema, uploadedDocs, verifyInEnclave, requestCredential]);

  const handleReset = useCallback(() => {
    setStep('select');
    setSelectedSchema(null);
    setUploadedDocs([]);
    setError(null);
  }, []);

  return (
    <div className="max-w-xl mx-auto">
      <div className="card p-6 md:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl shield-gradient flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Request Credential</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Submit documents for TEE-verified credential issuance
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {(['select', 'documents', 'verify', 'complete'] as RequestStep[]).map((s, idx) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  step === s
                    ? 'bg-brand-500'
                    : idx < ['select', 'documents', 'verify', 'complete'].indexOf(step)
                      ? 'bg-status-verified'
                      : 'bg-[var(--border-primary)]'
                }`}
              />
              {idx < 3 && (
                <div className="w-8 h-px bg-[var(--border-primary)] mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Error display */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step: Select Schema */}
        {step === 'select' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              Credential Type
            </label>
            <div className="relative">
              <button
                onClick={() => setSchemaDropdownOpen(!schemaDropdownOpen)}
                className="input flex items-center justify-between cursor-pointer"
              >
                <span className={selectedSchema ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}>
                  {selectedSchema?.label ?? 'Select a credential type...'}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${
                    schemaDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              <AnimatePresence>
                {schemaDropdownOpen && (
                  <motion.div
                    className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-lg overflow-hidden"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    {SCHEMA_OPTIONS.map((schema) => (
                      <button
                        key={schema.type}
                        onClick={() => handleSchemaSelect(schema)}
                        className={`w-full text-left px-4 py-3 hover:bg-[var(--surface-secondary)] transition-colors border-b border-[var(--border-secondary)] last:border-b-0 ${
                          selectedSchema?.type === schema.type ? 'bg-brand-500/5' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {schema.label}
                        </p>
                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          {schema.description}
                        </p>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {selectedSchema && (
              <motion.div
                className="p-4 rounded-xl bg-[var(--surface-secondary)] space-y-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                  <Info className="w-3.5 h-3.5" />
                  Required Documents
                </div>
                <ul className="space-y-1">
                  {selectedSchema.requiredDocuments.map((doc) => (
                    <li key={doc} className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                      {doc}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}

            <button onClick={handleProceedToDocuments} className="btn-primary w-full mt-4">
              Continue
            </button>
          </motion.div>
        )}

        {/* Step: Upload Documents */}
        {step === 'documents' && selectedSchema && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <p className="text-sm text-[var(--text-secondary)]">
              Upload the required documents for <strong>{selectedSchema.label}</strong>.
            </p>
            <div className="space-y-3">
              {selectedSchema.requiredDocuments.map((docType) => {
                const uploaded = uploadedDocs.find((d) => d.documentType === docType);
                return (
                  <div
                    key={docType}
                    className="p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)]"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{docType}</p>
                        {uploaded && (
                          <p className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono">
                            {uploaded.fileName}
                          </p>
                        )}
                      </div>
                      {uploaded ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-status-verified" />
                          <button
                            onClick={() => removeDocument(docType)}
                            className="p-1 rounded hover:bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleFileUpload(docType)}
                          className="btn-secondary btn-sm"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep('select')} className="btn-ghost flex-1">
                Back
              </button>
              <button onClick={handleProceedToVerify} className="btn-primary flex-1">
                Continue
              </button>
            </div>
          </motion.div>
        )}

        {/* Step: TEE Verification */}
        {step === 'verify' && selectedSchema && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="card p-5 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brand-500/10 flex items-center justify-center">
                <Lock className="w-7 h-7 text-brand-500" />
              </div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">
                TEE Verification
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Your documents will be verified inside a Trusted Execution Environment. No raw
                document data leaves the secure enclave.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)] mb-6">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>
                  Enclave: {enclaveStatus === 'ready' ? 'Ready' : 'Connecting...'}
                </span>
              </div>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || enclaveStatus !== 'ready'}
                className="btn-primary w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying in TEE...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Submit for Verification
                  </>
                )}
              </button>
            </div>
            <button onClick={() => setStep('documents')} className="btn-ghost w-full">
              Back
            </button>
          </motion.div>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-6"
          >
            <motion.div
              className="w-16 h-16 mx-auto mb-4 rounded-full bg-status-verified/10 flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
            >
              <CheckCircle2 className="w-8 h-8 text-status-verified" />
            </motion.div>
            <h4 className="text-lg font-bold text-[var(--text-primary)] mb-2">
              Credential Requested
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Your credential request has been submitted and is being processed. You will be
              notified once verification is complete.
            </p>
            <button onClick={handleReset} className="btn-secondary">
              <Plus className="w-4 h-4" />
              Request Another
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
