// JQL Query Builder Service
class JqlBuilder {
  constructor() {
    this.query = '';
    this.conditions = [];
  }

  // Create a new query builder instance
  static create() {
    return new JqlBuilder();
  }

  // Add a condition to the query
  where(field, operator, value) {
    if (!field || !operator) {
      throw new Error('Field and operator are required');
    }

    const condition = this.formatCondition(field, operator, value);
    this.conditions.push(condition);
    return this;
  }

  // Add an AND condition
  and(field, operator, value) {
    if (this.conditions.length === 0) {
      return this.where(field, operator, value);
    }
    return this.where(field, operator, value);
  }

  // Add an OR condition (creates a new group)
  or(field, operator, value) {
    if (this.conditions.length === 0) {
      return this.where(field, operator, value);
    }
    
    const condition = this.formatCondition(field, operator, value);
    const lastCondition = this.conditions[this.conditions.length - 1];
    this.conditions[this.conditions.length - 1] = `${lastCondition} OR ${condition}`;
    return this;
  }

  // Add project condition
  project(projectKey) {
    return this.where('project', '=', projectKey);
  }

  // Add status condition
  status(statusValue) {
    return this.where('status', '=', statusValue);
  }

  // Add assignee condition
  assignee(assigneeValue) {
    return this.where('assignee', '=', assigneeValue);
  }

  // Add fix version condition
  fixVersion(versionValue) {
    return this.where('fixVersion', '=', versionValue);
  }

  // Add labels condition
  labels(labelValue) {
    return this.where('labels', '=', labelValue);
  }

  // Add date range condition
  dateRange(field, startDate, endDate) {
    if (startDate && endDate) {
      return this.where(field, '>=', startDate).and(field, '<=', endDate);
    } else if (startDate) {
      return this.where(field, '>=', startDate);
    } else if (endDate) {
      return this.where(field, '<=', endDate);
    }
    return this;
  }

  // Add created date range
  createdBetween(startDate, endDate) {
    return this.dateRange('created', startDate, endDate);
  }

  // Add updated date range
  updatedBetween(startDate, endDate) {
    return this.dateRange('updated', startDate, endDate);
  }

  // Add ordering
  orderBy(field, direction = 'ASC') {
    this.orderClause = `ORDER BY ${field} ${direction.toUpperCase()}`;
    return this;
  }

  // Format a single condition
  formatCondition(field, operator, value) {
    const normalizedOperator = operator.toUpperCase();
    
    // Handle different value types
    if (value === null || value === undefined) {
      if (normalizedOperator === '=' || normalizedOperator === 'IS') {
        return `${field} IS EMPTY`;
      } else if (normalizedOperator === '!=' || normalizedOperator === 'IS NOT') {
        return `${field} IS NOT EMPTY`;
      }
    }

    // Handle arrays (for IN operations)
    if (Array.isArray(value)) {
      const formattedValues = value.map(v => this.formatValue(v)).join(', ');
      return `${field} ${normalizedOperator} (${formattedValues})`;
    }

    // Handle single values
    const formattedValue = this.formatValue(value);
    return `${field} ${normalizedOperator} ${formattedValue}`;
  }

  // Format a value based on its type
  formatValue(value) {
    if (typeof value === 'string') {
      // Check if it's a date
      if (this.isDateString(value)) {
        return `"${value}"`;
      }
      
      // Check if it needs quotes
      if (this.needsQuotes(value)) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      
      return value;
    }
    
    if (typeof value === 'number') {
      return value.toString();
    }
    
    if (value instanceof Date) {
      return `"${value.toISOString().split('T')[0]}"`;
    }
    
    return `"${String(value)}"`;
  }

  // Check if a string represents a date
  isDateString(str) {
    return /^\d{4}-\d{2}-\d{2}/.test(str) || 
           /^\d{1,2}\/\d{1,2}\/\d{4}/.test(str) ||
           str.includes('now()') ||
           str.includes('startOfDay()') ||
           str.includes('endOfDay()');
  }

  // Check if a string needs quotes
  needsQuotes(str) {
    // Don't quote JQL functions
    if (str.includes('()') || str.includes('currentUser()')) {
      return false;
    }
    
    // Quote if contains spaces or special characters
    return /[\s,()"]/.test(str);
  }

  // Build the final JQL string
  build() {
    if (this.conditions.length === 0) {
      return '';
    }
    
    let jql = this.conditions.join(' AND ');
    
    if (this.orderClause) {
      jql += ` ${this.orderClause}`;
    }
    
    return jql;
  }

  // Get the query string (alias for build)
  toString() {
    return this.build();
  }

  // Clear all conditions
  clear() {
    this.conditions = [];
    this.orderClause = null;
    return this;
  }

  // Clone the builder
  clone() {
    const newBuilder = new JqlBuilder();
    newBuilder.conditions = [...this.conditions];
    newBuilder.orderClause = this.orderClause;
    return newBuilder;
  }
}

// Pre-built query templates
export const jqlTemplates = {
  // Get all issues for a project
  projectIssues: (projectKey) => 
    JqlBuilder.create().project(projectKey).build(),

  // Get issues by fix version
  releaseIssues: (projectKey, fixVersion) => 
    JqlBuilder.create()
      .project(projectKey)
      .fixVersion(fixVersion)
      .orderBy('priority', 'DESC')
      .build(),

  // Get open issues assigned to user
  myOpenIssues: (username) => 
    JqlBuilder.create()
      .assignee(username)
      .where('status', 'NOT IN', ['Done', 'Closed', 'Resolved'])
      .orderBy('updated', 'DESC')
      .build(),

  // Get recently updated issues
  recentlyUpdated: (projectKey, days = 7) => 
    JqlBuilder.create()
      .project(projectKey)
      .where('updated', '>=', `-${days}d`)
      .orderBy('updated', 'DESC')
      .build(),

  // Get issues by labels
  labeledIssues: (projectKey, labels) => 
    JqlBuilder.create()
      .project(projectKey)
      .where('labels', 'IN', Array.isArray(labels) ? labels : [labels])
      .build(),

  // Get issues in sprint
  sprintIssues: (sprintName) => 
    JqlBuilder.create()
      .where('sprint', '=', sprintName)
      .orderBy('rank')
      .build(),

  // Get overdue issues
  overdueIssues: (projectKey) => 
    JqlBuilder.create()
      .project(projectKey)
      .where('duedate', '<', 'now()')
      .where('status', 'NOT IN', ['Done', 'Closed', 'Resolved'])
      .orderBy('duedate')
      .build(),

  // Get issues created in date range
  issuesCreatedBetween: (projectKey, startDate, endDate) => 
    JqlBuilder.create()
      .project(projectKey)
      .createdBetween(startDate, endDate)
      .orderBy('created', 'DESC')
      .build()
};

// Validation helpers
export const jqlValidators = {
  // Validate JQL syntax (basic)
  isValidJql: (jql) => {
    if (!jql || typeof jql !== 'string') return false;
    
    // Basic validation - check for common patterns
    const hasValidOperator = /\s+(=|!=|~|!~|>|>=|<|<=|IN|NOT IN|IS|IS NOT|WAS|WAS IN|WAS NOT|CHANGED)\s+/i.test(jql);
    const hasValidField = /\b(project|key|summary|status|assignee|reporter|created|updated|component|fixVersion|labels|priority|issuetype|resolution|description|duedate|sprint)\b/i.test(jql);
    
    return hasValidOperator || hasValidField;
  },

  // Check if JQL contains potentially expensive operations
  isExpensiveJql: (jql) => {
    const expensivePatterns = [
      /\btext\s*~/i,           // Text search
      /\bcomment\s*~/i,        // Comment search
      /\bdescription\s*~/i,    // Description search
      /\bsummary\s*~/i,        // Summary search
      /\bworklogAuthor\b/i,    // Worklog queries
      /\bwatchers\b/i          // Watcher queries
    ];
    
    return expensivePatterns.some(pattern => pattern.test(jql));
  },

  // Get JQL complexity score (0-10, higher is more complex)
  getComplexityScore: (jql) => {
    if (!jql) return 0;
    
    let score = 0;
    
    // Count operators
    const operators = (jql.match(/\s+(AND|OR)\s+/gi) || []).length;
    score += operators;
    
    // Count functions
    const functions = (jql.match(/\w+\(/g) || []).length;
    score += functions * 2;
    
    // Check for expensive operations
    if (jqlValidators.isExpensiveJql(jql)) {
      score += 5;
    }
    
    // Check for subqueries
    const subqueries = (jql.match(/\(/g) || []).length;
    score += subqueries;
    
    return Math.min(score, 10);
  }
};

export { JqlBuilder };