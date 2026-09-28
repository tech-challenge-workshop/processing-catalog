export class CreateProcessingRequestDto {
  ownerUserId!: string;
  ownerEmail!: string;
  sourceStorageKey!: string;
  idempotencyKey!: string;
}
