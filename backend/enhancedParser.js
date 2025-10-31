// Enhanced Parser with Scheduling Support
const chrono = require('chrono-node');

/**
 * Parse natural language payment instructions with scheduling support
 * @param {string} text - Natural language instruction
 * @returns {Object} Parsed instruction with intents and scheduling info
 */
function parseInstructionWithScheduling(text) {
  const lowerText = text.toLowerCase();
  const intents = [];
  let hasScheduling = false;
  let scheduledDate = null;
  let recurring = { enabled: false };
  
  // Parse temporal expressions using chrono-node
  const parsedDates = chrono.parse(text);
  
  if (parsedDates && parsedDates.length > 0) {
    hasScheduling = true;
    scheduledDate = parsedDates[0].start.date();
  }
  
  // Check for recurring patterns
  const recurringPatterns = [
    { pattern: /every\s+(day|daily)/i, frequency: 'daily' },
    { pattern: /every\s+(week|weekly)/i, frequency: 'weekly' },
    { pattern: /every\s+(month|monthly)/i, frequency: 'monthly' },
    { pattern: /every\s+(year|yearly|annually)/i, frequency: 'yearly' },
    { pattern: /bi-?weekly/i, frequency: 'biweekly' },
    { pattern: /quarterly/i, frequency: 'quarterly' }
  ];
  
  for (const { pattern, frequency } of recurringPatterns) {
    if (pattern.test(text)) {
      recurring = {
        enabled: true,
        frequency,
        interval: 1
      };
      hasScheduling = true;
      
      // If no specific date was parsed, default to starting tomorrow
      if (!scheduledDate) {
        scheduledDate = new Date();
        scheduledDate.setDate(scheduledDate.getDate() + 1);
        scheduledDate.setHours(9, 0, 0, 0);
      }
      break;
    }
  }
  
  // Extract payment intent
  const paymentPatterns = [
    /(?:send|pay|transfer|give)\s+(\d+(?:\.\d+)?)\s*(?:USDC|usdc|dollars?|USD|usd)?\s+(?:to|for)\s+([a-zA-Z0-9\s]+)/i,
    /pay\s+([a-zA-Z0-9\s]+)\s+(\d+(?:\.\d+)?)\s*(?:USDC|usdc|dollars?|USD|usd)?/i
  ];
  
  for (const pattern of paymentPatterns) {
    const match = text.match(pattern);
    if (match) {
      let amount, payee;
      
      if (match[0].startsWith('pay') && match[2]) {
        // "pay Netflix 13.99" format
        payee = match[1].trim();
        amount = parseFloat(match[2]);
      } else {
        // "send 50 to Alice" format
        amount = parseFloat(match[1]);
        payee = match[2].trim();
      }
      
      intents.push({
        type: 'payment',
        payee,
        amount,
        currency: 'USDC',
        recurring
      });
      break;
    }
  }
  
  // If no intent found but scheduling detected, try to extract basic info
  if (intents.length === 0 && hasScheduling) {
    const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
    
    // Try to find payee by looking for capitalized words
    const words = text.split(/\s+/);
    const payee = words.find(w => /^[A-Z][a-z]+/.test(w)) || 'Unknown';
    
    if (amount) {
      intents.push({
        type: 'payment',
        payee,
        amount,
        currency: 'USDC',
        recurring
      });
    }
  }
  
  // Generate natural language summary
  const naturalLanguageSummary = generateSummary(intents, scheduledDate, recurring);
  
  // Calculate confidence score
  const confidence = calculateConfidence(intents, hasScheduling, scheduledDate);
  
  return {
    raw: text,
    intents,
    hasScheduling,
    scheduledDate,
    recurring,
    naturalLanguageSummary,
    confidence,
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate human-readable summary of the parsed instruction
 */
function generateSummary(intents, scheduledDate, recurring) {
  if (intents.length === 0) {
    return "I couldn't understand that instruction. Please try again.";
  }
  
  const intent = intents[0];
  let summary = ``;
  
  if (recurring.enabled) {
    summary = `Set up ${recurring.frequency} payment of ${intent.amount} ${intent.currency} to ${intent.payee}`;
    if (scheduledDate) {
      summary += `, starting ${formatDateForDisplay(scheduledDate)}`;
    }
  } else if (scheduledDate) {
    summary = `Schedule payment of ${intent.amount} ${intent.currency} to ${intent.payee} on ${formatDateForDisplay(scheduledDate)}`;
  } else {
    summary = `Send ${intent.amount} ${intent.currency} to ${intent.payee} now`;
  }
  
  return summary;
}

/**
 * Calculate confidence score for the parsed instruction
 */
function calculateConfidence(intents, hasScheduling, scheduledDate) {
  let score = 0;
  
  // Base confidence from intent extraction
  if (intents.length > 0) {
    const intent = intents[0];
    if (intent.payee && intent.payee !== 'Unknown') score += 0.4;
    if (intent.amount && intent.amount > 0) score += 0.4;
  }
  
  // Bonus for clear scheduling
  if (hasScheduling && scheduledDate) {
    score += 0.2;
  }
  
  return Math.min(score, 1.0);
}

/**
 * Format date for display
 */
function formatDateForDisplay(date) {
  if (!date) return 'Unknown date';
  
  const d = new Date(date);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Check if it's today
  if (d.toDateString() === now.toDateString()) {
    return `today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Check if it's tomorrow
  if (d.toDateString() === tomorrow.toDateString()) {
    return `tomorrow at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Otherwise show full date
  const options = { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  };
  
  return d.toLocaleDateString('en-US', options);
}

/**
 * Parse simple date expressions (fallback if chrono fails)
 */
function parseSimpleDate(text) {
  const lowerText = text.toLowerCase();
  const now = new Date();
  
  if (lowerText.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }
  
  if (lowerText.includes('next week')) {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(9, 0, 0, 0);
    return nextWeek;
  }
  
  if (lowerText.includes('next month')) {
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(9, 0, 0, 0);
    return nextMonth;
  }
  
  return null;
}

module.exports = {
  parseInstructionWithScheduling,
  formatDateForDisplay,
  generateSummary,
  calculateConfidence
};