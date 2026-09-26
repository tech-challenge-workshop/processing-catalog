export class CreateProcessingRequestDto {
  ownerUserId!: string;
  sourceStorageKey!: string;
  idempotencyKey!: string;
}
