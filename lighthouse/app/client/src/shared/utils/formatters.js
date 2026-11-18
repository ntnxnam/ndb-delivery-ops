// Data formatting utilities

export const formatters = {
  // Date formatting
  date: (dateValue, format = 'dd/mmm/yyyy') => {
    if (!dateValue) return null;
    
    let date;
    if (typeof dateValue === 'string') {
      // Handle ISO format with time
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
        date = new Date(dateValue);
      }
      // Handle date-only format (YYYY-MM-DD)
      else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        date = new Date(dateValue + 'T00:00:00');
      }
      else {
        date = new Date(dateValue);
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      return null;
    }
    
    if (isNaN(date.getTime())) {
      return null;
    }
    
    switch (format) {
      case 'dd/mmm/yyyy': {
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      }
      case 'yyyy-mm-dd': {
        return date.toISOString().split('T')[0];
      }
      case 'mm/dd/yyyy': {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
      }
      case 'relative': {
        return formatters.relativeTime(date);
      }
      default:
        return formatters.date(date, 'dd/mmm/yyyy');
    }
  },

  // Relative time formatting (e.g., "2 hours ago")
  relativeTime: (date) => {
    if (!date) return null;
    
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) !== 1 ? 's' : ''} ago`;
    return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) !== 1 ? 's' : ''} ago`;
  },

  // Username normalization
  username: (input) => {
    if (!input) return '';
    const trimmed = String(input).trim().toLowerCase();
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0];
    }
    return trimmed;
  },

  // Email formatting
  email: (username) => {
    if (!username) return '';
    const normalized = formatters.username(username);
    return `${normalized}@nutanix.com`;
  },

  // File size formatting
  fileSize: (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  },

  // Number formatting
  number: (num, options = {}) => {
    if (num === null || num === undefined) return '';
    
    const {
      decimals = 0,
      thousands = ',',
      decimal = '.',
      prefix = '',
      suffix = ''
    } = options;
    
    const n = Number(num);
    if (isNaN(n)) return num;
    
    const fixed = n.toFixed(decimals);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    
    return prefix + parts.join(decimal) + suffix;
  },

  // Percentage formatting
  percentage: (value, decimals = 1) => {
    if (value === null || value === undefined) return '';
    const num = Number(value);
    if (isNaN(num)) return value;
    return `${num.toFixed(decimals)}%`;
  },

  // Text truncation
  truncate: (text, maxLength = 100, suffix = '...') => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  },

  // Capitalize first letter
  capitalize: (text) => {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  },

  // Title case
  titleCase: (text) => {
    if (!text) return text;
    return text.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  },

  // JIRA key formatting
  jiraKey: (key) => {
    if (!key) return '';
    return key.toUpperCase();
  },

  // Status formatting
  status: (status) => {
    if (!status) return '';
    return formatters.titleCase(status.replace(/[_-]/g, ' '));
  },

  // Priority formatting with colors
  priority: (priority) => {
    if (!priority) return { text: '', color: '' };
    
    const p = priority.toLowerCase();
    const priorityMap = {
      'highest': { text: 'Highest', color: '#d04437' },
      'high': { text: 'High', color: '#f79232' },
      'medium': { text: 'Medium', color: '#f1c232' },
      'low': { text: 'Low', color: '#14892c' },
      'lowest': { text: 'Lowest', color: '#707070' }
    };
    
    return priorityMap[p] || { text: formatters.capitalize(priority), color: '#707070' };
  },

  // Array to comma-separated string
  arrayToString: (array, separator = ', ', lastSeparator = ' and ') => {
    if (!Array.isArray(array)) return array;
    if (array.length === 0) return '';
    if (array.length === 1) return array[0];
    if (array.length === 2) return array.join(lastSeparator);
    
    const last = array.pop();
    return array.join(separator) + lastSeparator + last;
  },

  // Duration formatting (milliseconds to human readable)
  duration: (ms) => {
    if (!ms || ms < 0) return '0ms';
    
    const units = [
      { name: 'd', value: 24 * 60 * 60 * 1000 },
      { name: 'h', value: 60 * 60 * 1000 },
      { name: 'm', value: 60 * 1000 },
      { name: 's', value: 1000 },
      { name: 'ms', value: 1 }
    ];
    
    for (const unit of units) {
      const count = Math.floor(ms / unit.value);
      if (count >= 1) {
        return `${count}${unit.name}`;
      }
    }
    
    return '0ms';
  }
};