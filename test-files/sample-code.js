// Sample JavaScript file for Read tool testing
function greetUser(name) {
  console.log(`Hello, ${name}!`);
  
  // This is a comment
  if (name.length > 10) {
    console.log("That's a long name!");
  }
  
  return `Welcome, ${name}`;
}

const users = ['Alice', 'Bob', 'Charlie'];
users.forEach(user => greetUser(user));

module.exports = { greetUser };