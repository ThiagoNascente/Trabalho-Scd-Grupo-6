using System.ComponentModel.DataAnnotations;

namespace AuthService.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public int Wins { get; set; } = 0;
}

public class UserDto
{
    [Required]
    [StringLength(30, MinimumLength = 4, ErrorMessage = "O Username deve ter entre 4 e 30 caracteres.")]
    public string Username { get; set; } = string.Empty;

    [Required]
    [StringLength(30, MinimumLength = 4, ErrorMessage = "A senha deve ter entre 4 e 30 caracteres.")]
    public string Password { get; set; } = string.Empty;
}
