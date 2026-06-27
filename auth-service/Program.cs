using System.Text;
using AuthService.Data;
using AuthService.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
// gRPC síncrono (item 8): endpoint de validação de sessão chamado pelo gateway.
builder.Services.AddGrpc();

// Database connection (Using Postgres from docker-compose)
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Port=5432;Database=authdb;Username=postgres;Password=password";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

// JWT Authentication
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
// Segredo do JWT vem SEMPRE de variável de ambiente (JwtSettings__Secret / JWT_SECRET no .env).
// Sem o segredo, a aplicação não sobe (falha explícita, sem default chumbado).
var secretKey = jwtSettings["Secret"]
    ?? throw new InvalidOperationException("JWT secret não configurado. Defina JwtSettings__Secret (JWT_SECRET no .env / EC2).");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings["Issuer"] ?? "spaceship_auth",
            ValidAudience = jwtSettings["Audience"] ?? "spaceship_gateway",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey))
        };
    });

// CORS Config
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Kestrel: REST (HTTP/1.1) na 5000 e gRPC (HTTP/2) numa porta separada
// (GRPC_PORT, padrão 5005). gRPC em h2c (texto puro) — TLS está fora de escopo
// nesta versão; o gateway conecta com credenciais inseguras (rede privada da VPC).
var grpcPort = int.TryParse(builder.Configuration["GRPC_PORT"], out var gp) ? gp : 5005;
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(5000, lo => lo.Protocols = HttpProtocols.Http1);
    options.ListenAnyIP(grpcPort, lo => lo.Protocols = HttpProtocols.Http2);
});

var app = builder.Build();

// Configure the HTTP request pipeline.
app.UseCors("AllowFrontend");

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
// Endpoint gRPC (item 8) — responde na porta HTTP/2 (GRPC_PORT).
app.MapGrpcService<AuthValidationService>();

// Ensure Database is created (For dev purposes only)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    try
    {
        db.Database.ExecuteSqlRaw("ALTER TABLE \"Users\" ADD COLUMN \"Wins\" integer NOT NULL DEFAULT 0;");
    }
    catch
    {
        // Ignora se a coluna já existir.
    }
}

// As portas/protocolos vêm do ConfigureKestrel acima (REST 5000 + gRPC GRPC_PORT).
app.Run();
