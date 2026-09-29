export class CreateProcessingRequestDto {
  ownerUserId!: string;
  ownerEmail!: string;
  sourceStorageKey!: string;
  idempotencyKey!: string;
  /** Optional trace id; the use case validates it when present. */
  correlationId?: string;
}
