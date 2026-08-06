/**
 * Validation Tests
 */

import {
  isValidEmail,
  isValidWalletAddress,
  isValidURL,
  isInRange,
  isValidLength,
  validateRequired,
  validateType,
  isValidUUID,
} from '../validation';

describe('Validation Utilities', () => {
  describe('isValidEmail', () => {
    it('should validate correct email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
    });
    
    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
    });
  });
  
  describe('isValidWalletAddress', () => {
    // An Ethereum address is exactly 40 hex characters after the 0x prefix;
    // the fixtures below are counted, not eyeballed.
    it('should validate correct Ethereum addresses', () => {
      expect(isValidWalletAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(true);
      expect(isValidWalletAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(isValidWalletAddress('0x123')).toBe(false);
      // Correct length and characters, missing prefix.
      expect(isValidWalletAddress('742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(false);
      // Correct prefix, one character short.
      expect(isValidWalletAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44')).toBe(false);
      expect(isValidWalletAddress('')).toBe(false);
    });
  });
  
  describe('isValidURL', () => {
    it('should validate correct URLs', () => {
      expect(isValidURL('https://example.com')).toBe(true);
      expect(isValidURL('http://localhost:3000')).toBe(true);
    });
    
    it('should reject invalid URLs', () => {
      expect(isValidURL('not-a-url')).toBe(false);
      expect(isValidURL('')).toBe(false);
    });
  });
  
  describe('isInRange', () => {
    it('should validate numbers in range', () => {
      expect(isInRange(5, 0, 10)).toBe(true);
      expect(isInRange(0, 0, 10)).toBe(true);
      expect(isInRange(10, 0, 10)).toBe(true);
    });
    
    it('should reject numbers out of range', () => {
      expect(isInRange(-1, 0, 10)).toBe(false);
      expect(isInRange(11, 0, 10)).toBe(false);
    });
  });
  
  describe('isValidLength', () => {
    it('should validate string length', () => {
      expect(isValidLength('abc', 1, 5)).toBe(true);
      expect(isValidLength('a', 1, 5)).toBe(true);
      expect(isValidLength('abcde', 1, 5)).toBe(true);
    });
    
    it('should reject strings with invalid length', () => {
      expect(isValidLength('', 1, 5)).toBe(false);
      expect(isValidLength('abcdef', 1, 5)).toBe(false);
    });
  });
  
  describe('validateRequired', () => {
    it('should validate required fields', () => {
      const data = { name: 'test', age: 25 };
      const result = validateRequired(data, ['name', 'age']);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
    
    it('should detect missing fields', () => {
      const data = { name: 'test', age: undefined };
      const result = validateRequired(data, ['name', 'age']);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('age');
    });
  });
  
  describe('validateType', () => {
    it('should validate correct types', () => {
      expect(validateType('string', 'string')).toBe(true);
      expect(validateType(123, 'number')).toBe(true);
      expect(validateType(true, 'boolean')).toBe(true);
      expect(validateType({}, 'object')).toBe(true);
      expect(validateType([], 'array')).toBe(true);
    });
    
    it('should reject incorrect types', () => {
      expect(validateType(123, 'string')).toBe(false);
      expect(validateType('123', 'number')).toBe(false);
      expect(validateType(null, 'object')).toBe(false);
    });
  });
  
  describe('isValidUUID', () => {
    it('should validate correct UUIDs', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });
    
    it('should reject invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });
});









