import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App component', () => {
  it('renders React element successfully', () => {
    const element = App();
    expect(element).toBeDefined();
    expect(element.type).toBe('div');
  });
});
