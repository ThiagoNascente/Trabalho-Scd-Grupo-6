using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AuthService.Data;
using AuthService.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace AuthService.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly IConfiguration _config;

    public AuthController(AppDbContext context, IConfiguration config)
    {
        _context = context;
        _config = config;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(UserDto request)
    {
        if (await _context.Users.AnyAsync(u => u.Username == request.Username))
            return BadRequest("User already exists.");

        var user = new User
        {
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        return Ok(new { message = "User registered successfully." });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(UserDto request)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return BadRequest("Invalid credentials.");

        var token = GenerateJwtToken(user);
        return Ok(new { token });
    }

    [HttpGet("wins/{username}")]
    public async Task<IActionResult> GetWins(string username)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user == null)
            return NotFound("User not found.");

        return Ok(new { wins = user.Wins });
    }

    [HttpPost("wins/{username}/increment")]
    public async Task<IActionResult> IncrementWins(string username)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user == null)
            return NotFound("User not found.");

        user.Wins++;
        await _context.SaveChangesAsync();

        return Ok(new { wins = user.Wins });
    }

    private string GenerateJwtToken(User user)
    {
        var jwtSettings = _config.GetSection("JwtSettings");
        // Segredo do JWT vem SEMPRE de variável de ambiente — sem default chumbado.
        var secretKey = jwtSettings["Secret"]
            ?? throw new InvalidOperationException("JWT secret não configurado. Defina JwtSettings__Secret (JWT_SECRET no .env / EC2).");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Username),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("id", user.Id.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"] ?? "spaceship_auth",
            audience: jwtSettings["Audience"] ?? "spaceship_gateway",
            claims: claims,
            expires: DateTime.UtcNow.AddHours(2),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
