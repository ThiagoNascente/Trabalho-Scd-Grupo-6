using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AuthService.Data;
using AuthService.Grpc;
using Grpc.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace AuthService.Services;

// ==========================================================================
// Serviço gRPC do Auth (item 8 — RPC SÍNCRONO/bloqueante).
//
// O Game Gateway chama ValidateToken na conexão de cada cliente. Aqui o Auth
// (servidor canônico) valida a ASSINATURA/emissor/audiência/expiração do JWT e
// confirma que o USUÁRIO AINDA EXISTE no banco — algo que a validação local do
// gateway não consegue. Assim, remover o usuário invalida novas conexões
// (aceite do item 8).
//
// O segredo do JWT vem SEMPRE de variável de ambiente (sem default chumbado),
// igual ao restante do Auth (Program.cs / AuthController.cs).
// ==========================================================================
public class AuthValidationService : AuthValidation.AuthValidationBase
{
    private readonly AppDbContext _context;
    private readonly IConfiguration _config;

    public AuthValidationService(AppDbContext context, IConfiguration config)
    {
        _context = context;
        _config = config;
    }

    public override async Task<ValidateTokenReply> ValidateToken(
        ValidateTokenRequest request, ServerCallContext context)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
            return new ValidateTokenReply { Valid = false, Reason = "empty token" };

        var jwtSettings = _config.GetSection("JwtSettings");
        var secretKey = jwtSettings["Secret"]
            ?? throw new InvalidOperationException(
                "JWT secret não configurado. Defina JwtSettings__Secret (JWT_SECRET no .env / EC2).");

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false }; // mantém o claim 'sub'
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings["Issuer"] ?? "spaceship_auth",
            ValidAudience = jwtSettings["Audience"] ?? "spaceship_gateway",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)),
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        ClaimsPrincipal principal;
        try
        {
            principal = handler.ValidateToken(request.Token, parameters, out _);
        }
        catch (Exception ex)
        {
            // Assinatura inválida, expirado, emissor/audiência errados, etc.
            return new ValidateTokenReply { Valid = false, Reason = ex.GetType().Name };
        }

        var username = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? string.Empty;

        if (string.IsNullOrEmpty(username))
            return new ValidateTokenReply { Valid = false, Reason = "no subject" };

        // Revogação real: a sessão só é válida se o usuário ainda existir.
        var exists = await _context.Users.AnyAsync(u => u.Username == username);
        if (!exists)
            return new ValidateTokenReply { Valid = false, Reason = "user not found" };

        return new ValidateTokenReply { Valid = true, Username = username };
    }
}
